const yahooFinance = require("yahoo-finance2").default;
const cache = require("./cache");

const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const API_DELAY_MS = 200; // Delay between individual historical data requests to Yahoo Finance

// --- ADD THIS SECTION ---
// The URL of the Cloudflare Worker you just deployed.
// Replace this with your actual worker URL.
const CLOUDFLARE_PROXY_URL = "https://yahoobackend.aditya-goel-gis.workers.dev";
// ------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getCurrentPrice(symbol) {
  // The library can take a single symbol or an array of symbols
  try {
    console.log(
      `📡 Fetching current price for [${symbol}] via proxy: ${CLOUDFLARE_PROXY_URL}`
    );
    const quote = await yahooFinance.quote(
      symbol,
      {},
      { baseUrl: CLOUDFLARE_PROXY_URL }
    );

    // If it's an array, the result is an array. If single, it's an object.
    if (Array.isArray(quote)) {
      // Filter out any null/undefined results for invalid symbols and format valid ones.
      return quote
        .filter((q) => q && q.regularMarketPrice != null)
        .map((q) => ({
          symbol: q.symbol,
          price: q.regularMarketPrice,
          change: q.regularMarketChange,
          changePercent: q.regularMarketChangePercent,
          time: q.regularMarketTime,
        }));
    }

    // Handle single symbol case, ensuring quote is not null.
    return {
      symbol: symbol,
      price: quote?.regularMarketPrice,
      change: quote?.regularMarketChange,
      changePercent: quote?.regularMarketChangePercent,
      time: quote?.regularMarketTime,
    };
  } catch (err) {
    console.error(`❌ Error fetching current price for ${symbol}:`, err);
    throw err;
  }
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
