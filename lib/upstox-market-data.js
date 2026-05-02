const axios = require("axios");
const zlib = require("zlib");
const cache = require("./cache");
const { getUpstoxClient } = require("./upstox-client");

const DATABASE_SERVER_URL = process.env.DATABASE_SERVER_URL || "http://localhost:3001";
const NSE_INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
const INSTRUMENT_CACHE_KEY = "upstox:nse:instrument-map";
const INSTRUMENT_CACHE_TTL = 24 * 60 * 60 * 1000;
const PRICE_CACHE_TTL = 5 * 60 * 1000;
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000;

const stripYahooSuffix = (symbol) => String(symbol || "").replace(/\.NS$/i, "").toUpperCase();
const normalizeSymbol = (symbol) => stripYahooSuffix(symbol).replace(/[^A-Z0-9]/g, "");

const isAuthFailure = (err) => {
  const message = String(err?.message || "").toLowerCase();
  return err?.response?.status === 401 || message.includes("401") || message.includes("unauthorized");
};

const loadTokenFromDatabase = async () => {
  try {
    const response = await fetch(`${DATABASE_SERVER_URL}/api/upstox-token`);
    if (!response.ok) {
      throw new Error(`Database server error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const accessToken = result?.data?.accessToken;
    if (accessToken) {
      process.env.UPSTOX_ACCESS_TOKEN = accessToken;
    }
  } catch (error) {
    console.warn("[Upstox Fallback] Could not load token from database:", error.message);
  }
};

const getClientWithPersistedToken = async () => {
  if (!process.env.UPSTOX_ACCESS_TOKEN) {
    await loadTokenFromDatabase();
  }

  return getUpstoxClient();
};

const getInstrumentMap = async () => {
  const cached = cache.get(INSTRUMENT_CACHE_KEY);
  if (cached) return cached;

  console.log("[Upstox Fallback] Downloading NSE instrument map");
  const response = await axios.get(NSE_INSTRUMENTS_URL, {
    responseType: "arraybuffer",
    timeout: 30000
  });

  const rawBuffer = Buffer.from(response.data);
  let instrumentJson;
  try {
    instrumentJson = zlib.gunzipSync(rawBuffer).toString("utf8");
  } catch (error) {
    instrumentJson = rawBuffer.toString("utf8");
  }

  const instruments = JSON.parse(instrumentJson);
  const map = new Map();

  for (const instrument of instruments) {
    if (
      instrument.segment === "NSE_EQ" &&
      instrument.exchange === "NSE" &&
      instrument.trading_symbol &&
      instrument.instrument_key
    ) {
      const existing = map.get(instrument.trading_symbol);
      if (!existing || instrument.instrument_type === "EQ") {
        map.set(instrument.trading_symbol, instrument);
      }
    }
  }

  cache.set(INSTRUMENT_CACHE_KEY, map, INSTRUMENT_CACHE_TTL);
  return map;
};

const resolveInstrument = async (symbol) => {
  const tradingSymbol = stripYahooSuffix(symbol);
  const instrumentMap = await getInstrumentMap();
  const instrument = instrumentMap.get(tradingSymbol);

  if (!instrument) {
    throw new Error(`Upstox instrument not found for ${symbol}`);
  }

  return instrument;
};

const parseQuote = (quote) => {
  const price = quote?.last_price ?? quote?.ltp ?? quote?.lastPrice ?? null;
  const change = quote?.net_change ?? quote?.netChange ?? null;
  const previousClose = quote?.ohlc?.close ?? quote?.close_price ?? null;
  const changePercent =
    previousClose && change != null
      ? (change / previousClose) * 100
      : quote?.change_percent ?? quote?.changePercent ?? null;

  return {
    price,
    change,
    changePercent,
    time: quote?.timestamp || quote?.last_trade_time || new Date().toISOString()
  };
};

const fetchLatestHistoricalPrice = async (client, symbol, instrument) => {
  const today = new Date();
  const toDate = today.toISOString().split("T")[0];
  const fromDateObj = new Date();
  fromDateObj.setDate(fromDateObj.getDate() - 14);
  const fromDate = fromDateObj.toISOString().split("T")[0];

  const response = await client.axiosInstance.get(
    `/historical-candle/${encodeURIComponent(instrument.instrument_key)}/day/${toDate}/${fromDate}`,
    {
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        Accept: "application/json"
      }
    }
  );

  const candles = response.data?.data?.candles || [];
  const latest = candles[0];
  const previous = candles[1];

  if (!latest || latest[4] == null) {
    return null;
  }

  const close = latest[4];
  const previousClose = previous?.[4] ?? null;
  const change = previousClose != null ? close - previousClose : null;

  return {
    symbol,
    price: close,
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : null,
    time: new Date(latest[0]).toISOString()
  };
};

const findQuoteForInstrument = (quoteData, instrument) => {
  const quoteValues = Object.values(quoteData || {});
  return quoteData[instrument.instrument_key.replace("|", ":")] ||
    quoteData[instrument.instrument_key] ||
    quoteData[`${instrument.segment}:${instrument.trading_symbol}`] ||
    quoteValues.find((item) => item?.instrument_token === instrument.instrument_key) ||
    quoteValues.find((item) => item?.instrument_key === instrument.instrument_key) ||
    quoteValues.find((item) => normalizeSymbol(item?.symbol || item?.trading_symbol || item?.tradingsymbol) === normalizeSymbol(instrument.trading_symbol));
};

const fetchUpstoxCurrentPrices = async (symbols) => {
  const client = await getClientWithPersistedToken();
  if (!client.accessToken) {
    throw new Error("Upstox access token not available for fallback");
  }

  const resolved = await Promise.all(symbols.map(async (symbol) => ({
    symbol,
    instrument: await resolveInstrument(symbol)
  })));

  const response = await client.axiosInstance.get("/market-quote/quotes", {
    params: {
      instrument_key: resolved.map((item) => item.instrument.instrument_key).join(",")
    },
    headers: {
      Authorization: `Bearer ${client.accessToken}`,
      Accept: "application/json"
    }
  });

  let quoteData = response.data?.data;

  if (response.data?.status !== "success" || !quoteData) {
    console.warn("[Upstox Fallback] Quote API returned no data, trying LTP endpoint");
    const ltpResponse = await client.axiosInstance.get("/market-quote/ltp", {
      params: {
        instrument_key: resolved.map((item) => item.instrument.instrument_key).join(",")
      },
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        Accept: "application/json"
      }
    });
    quoteData = ltpResponse.data?.data;
  }

  if (!quoteData) {
    throw new Error("Upstox quote API returned no data");
  }

  const results = [];

  for (const { symbol, instrument } of resolved) {
    const quote = findQuoteForInstrument(quoteData, instrument);
    const parsed = parseQuote(quote);

    if (parsed.price == null) {
      try {
        const historicalPrice = await fetchLatestHistoricalPrice(client, symbol, instrument);
        if (historicalPrice?.price != null) {
          cache.set(`price:${symbol}`, historicalPrice, PRICE_CACHE_TTL);
          results.push(historicalPrice);
          continue;
        }
      } catch (error) {
        console.warn(`[Upstox Fallback] Latest candle price failed for ${symbol}:`, error.message);
      }

      results.push({ symbol, error: "No price data found" });
      continue;
    }

    const priceData = { symbol, ...parsed };
    cache.set(`price:${symbol}`, priceData, PRICE_CACHE_TTL);
    results.push(priceData);
  }

  return results;
};

const fetchUpstoxHistoricalData = async (symbols) => {
  const client = await getClientWithPersistedToken();
  if (!client.accessToken) {
    throw new Error("Upstox access token not available for fallback");
  }

  const today = new Date();
  const toDate = today.toISOString().split("T")[0];
  const fromDateObj = new Date();
  fromDateObj.setFullYear(today.getFullYear() - 3);
  const fromDate = fromDateObj.toISOString().split("T")[0];

  const allHistoricalData = [];
  const errors = [];

  for (const symbol of symbols) {
    try {
      const instrument = await resolveInstrument(symbol);
      const response = await client.axiosInstance.get(
        `/historical-candle/${encodeURIComponent(instrument.instrument_key)}/day/${toDate}/${fromDate}`,
        {
          headers: {
            Authorization: `Bearer ${client.accessToken}`,
            Accept: "application/json"
          }
        }
      );

      const candles = response.data?.data?.candles || [];
      const formatted = candles.map((candle) => ({
        symbol,
        date: new Date(candle[0]).toISOString(),
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));

      cache.set(`historical:${symbol}`, formatted, HISTORICAL_CACHE_TTL);
      allHistoricalData.push(...formatted);
    } catch (error) {
      errors.push({ symbol, error: error.message || "Failed to fetch historical data from Upstox" });
    }
  }

  return { data: allHistoricalData, errors };
};

module.exports = {
  fetchUpstoxCurrentPrices,
  fetchUpstoxHistoricalData,
  isAuthFailure
};
