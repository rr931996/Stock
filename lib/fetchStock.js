const yahooFinance = require("yahoo-finance2").default;
const cache = require("./cache");

const PRICE_CACHE_TTL = 5 * 60; // 5 minutes in seconds for node-cache
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const API_DELAY_MS = 200; // Delay between individual historical data requests to Yahoo Finance

// --- ADD THIS SECTION ---
// The URL of the Cloudflare Worker you just deployed.
// Replace this with your actual worker URL.
const CLOUDFLARE_PROXY_URL = "https://yahoobackend.aditya-goel-gis.workers.dev";
// ------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getCurrentPrice(symbols) {
  const symbolsToFetch = [];
  const cachedPrices = [];

  // 1. Check cache for each symbol
  for (const symbol of symbols) {
    const cacheKey = `price:${symbol}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      cachedPrices.push(cached);
    } else {
      symbolsToFetch.push(symbol);
    }
  }

  // 2. Fetch prices for non-cached symbols in a single batch
  if (symbolsToFetch.length > 0) {
    try {
      console.log(
        `📡 Fetching current price for [${symbolsToFetch.join(
          ", "
        )}] via proxy: ${CLOUDFLARE_PROXY_URL}`
      );
      const quotes = await yahooFinance.quote(
        symbolsToFetch,
        {},
        { baseUrl: CLOUDFLARE_PROXY_URL }
      );

      const newPrices = quotes
        .filter((q) => q && q.regularMarketPrice != null)
        .map((q) => ({
          symbol: q.symbol,
          price: q.regularMarketPrice,
          change: q.regularMarketChange,
          changePercent: q.regularMarketChangePercent,
          time: q.regularMarketTime,
        }));

      // 3. Cache the newly fetched prices and add them to our results
      newPrices.forEach((price) => {
        const cacheKey = `price:${price.symbol}`;
        cache.set(cacheKey, price, PRICE_CACHE_TTL);
        cachedPrices.push(price);
      });
    } catch (err) {
      console.error(`❌ Error fetching current prices for ${symbolsToFetch.join(", ")}:`, err);
      // We can decide to throw or just return what we have from cache
      // For now, we'll throw to let the caller handle it.
      throw err;
    }
  }

  // 4. Return the combined list of cached and newly fetched prices
  return cachedPrices;
}

async function fetchStockData(symbols) {
  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);

  const allHistoricalData = [];
  const symbolsToFetch = [];
  const errors = [];

  // 1. Check cache for each symbol
  for (const symbol of symbols) {
    const cacheKey = `historical:${symbol}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      allHistoricalData.push(...cached);
    } else {
      symbolsToFetch.push(symbol);
    }
  }

  // 2. Fetch data for non-cached symbols
  for (const symbol of symbolsToFetch) {
    try {
      console.log(
        `📡 Fetching historical data for [${symbol}] via proxy: ${CLOUDFLARE_PROXY_URL}`
      );
      const chart = await yahooFinance.chart(
        symbol,
        {
          period1: threeYearsAgo,
          period2: today,
          interval: "1d",
        },
        { baseUrl: CLOUDFLARE_PROXY_URL }
      );
      const history = chart.quotes;

      // Ensure history is not null or empty before processing
      if (history && history.length > 0) {
        const formatted = history.map((item) => ({
          symbol,
          date: item.date,
          high: item.high,
          low: item.low,
        }));

        // Cache individual historical data
        const cacheKey = `historical:${symbol}`;
        cache.set(cacheKey, formatted, HISTORICAL_CACHE_TTL);

        allHistoricalData.push(...formatted);
      } else {
        console.warn(`⚠️ No historical data returned for ${symbol}.`);
      }

      // Add a small delay between requests to avoid hitting rate limits
      await sleep(API_DELAY_MS);
    } catch (err) {
      console.error(`❌ Error fetching historical data for ${symbol}:`, err);
      errors.push({ symbol, error: "Failed to fetch historical data." });
    }
  }

  // Return both the data and any errors that occurred.
  return { data: allHistoricalData, errors };
}

module.exports = {
  fetchStockData,
  getCurrentPrice,
};
