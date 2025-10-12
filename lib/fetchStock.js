const yahooFinance = require("yahoo-finance2").default;
const cache = require("./cache");
const { HttpsProxyAgent } = require("https-proxy-agent");

const PRICE_CACHE_TTL = 5 * 60; // 5 minutes in seconds for node-cache
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const API_DELAY_MS = 200; // Delay between individual historical data requests to Yahoo Finance

// --- ROTATING PROXY CONFIGURATION ---
// These values should be set in your environment (.env file or hosting provider)
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

function getProxyAgent() {
  // Use proxy if the host is configured, regardless of NODE_ENV
  // This makes local testing easier without changing NODE_ENV.
  if (!PROXY_HOST || !PROXY_PORT || !PROXY_USERNAME || !PROXY_PASSWORD) {
    return undefined; // Don't use proxy in local development unless configured
  }
  const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
  return new HttpsProxyAgent(proxyUrl);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getCurrentPrice(symbols) {
  const symbolsToFetch = [];
  const results = {};

  // 1. Check cache for each symbol
  for (const symbol of symbols) {
    const cacheKey = `price:${symbol}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      results[symbol] = cached;
    } else {
      symbolsToFetch.push(symbol);
    }
  }

  // 2. Fetch prices for non-cached symbols in a single batch
  if (symbolsToFetch.length > 0) {
    try {
      const agent = getProxyAgent();
      const quotes = await yahooFinance.quote(
        symbolsToFetch,
        { /* query options */ },
        { fetchOptions: { agent } } // Pass the proxy agent here
      );

      // `quotes` is an array where some elements might be undefined if the symbol is invalid.
      // We need to map it back to the original symbols requested.
      const quotesBySymbol = quotes.reduce((acc, q) => {
        if (q && q.symbol) acc[q.symbol] = q;
        return acc;
      }, {});

      for (const symbol of symbolsToFetch) {
        const quote = quotesBySymbol[symbol];
        if (quote && quote.regularMarketPrice != null) {
          const priceData = {
            symbol: quote.symbol,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent,
            time: quote.regularMarketTime,
          };
          results[symbol] = priceData;
          cache.set(`price:${symbol}`, priceData, PRICE_CACHE_TTL);
        } else {
          // If a symbol is invalid, return an error object for it.
          results[symbol] = { symbol, error: "No price data found" };
        }
      }
    } catch (err) {
      console.error(`❌ Error fetching current prices for ${symbolsToFetch.join(", ")}:`, err);
      symbolsToFetch.forEach(symbol => {
        // Ensure that every symbol that was part of the failed fetch
        // gets a proper error object in the results.
        if (!results[symbol]) results[symbol] = { symbol, error: "Failed to fetch price data" };
      });
    }
  }

  // 4. Return an array of all results, ensuring order is not required by frontend
  return Object.values(results);
}

async function fetchStockData(symbols) {
  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);

  const allHistoricalData = [];
  const symbolsToFetch = [];
  const errors = [];
  const backgroundFetchPromises = [];

  // 1. Check cache for each symbol
  for (const symbol of symbols) {
    const cacheKey = `historical:${symbol}`;
    // Use allowStale to get an item even if its TTL has expired.
    const cachedItem = cache.get(cacheKey, { allowStale: true });

    if (cachedItem) {
      allHistoricalData.push(...cachedItem);

      // If cache.has(key) is false, it means the item we just got with
      // allowStale:true is indeed expired. We should trigger a background
      // fetch to update it, but we don't need to wait for it.
      if (!cache.has(cacheKey)) {
        backgroundFetchPromises.push(fetchAndCacheSingleSymbol(symbol));
      }
    } else {
      symbolsToFetch.push(symbol);
    }
  }

  // 2. Fetch data for all non-cached symbols in a single batch request
  // This is for symbols that were never in the cache. We need to wait for these.
  if (symbolsToFetch.length > 0) {
    const initialFetchPromises = symbolsToFetch.map(symbol => fetchAndCacheSingleSymbol(symbol));
    const settledResults = await Promise.allSettled(initialFetchPromises);

    settledResults.forEach((res, index) => {
      if (res.status === 'fulfilled' && res.value) {
        allHistoricalData.push(...res.value);
      } else if (res.status === 'rejected') {
        const symbol = symbolsToFetch[index];
        errors.push({ symbol, error: res.reason.message || "Failed to fetch historical data." });
      }
    });
  }

  // Don't wait for background fetches to complete before responding.
  // This is a "fire and forget" operation.
  Promise.allSettled(backgroundFetchPromises).then(results => {
    results.forEach((res, i) => {
      if (res.status === 'rejected') {
        // Log background errors, but don't crash the server.
        console.error(`Background fetch failed for stale cache:`, res.reason);
      }
    });
  });

  // Return the immediately available data (cached or freshly fetched).
  return { data: allHistoricalData, errors };
}

async function fetchAndCacheSingleSymbol(symbol) {
  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);
  const agent = getProxyAgent();
  await sleep(API_DELAY_MS); // Add delay before each request

  const result = await yahooFinance.chart(
    symbol,
    { period1: threeYearsAgo, period2: today, interval: "1d" },
    { fetchOptions: { agent } }
  );

  if (result && result.quotes && result.quotes.length > 0) {
    const formatted = result.quotes.map((item) => ({
      symbol,
      date: item.date,
      high: item.high,
      low: item.low,
    }));
    cache.set(`historical:${symbol}`, formatted, HISTORICAL_CACHE_TTL);
    return formatted;
  } else {
    const errorMessage = (result && result.error) ? result.error.message : `No historical data found for ${symbol}.`;
    throw new Error(errorMessage);
  }
}

module.exports = {
  fetchStockData,
  getCurrentPrice,
};
