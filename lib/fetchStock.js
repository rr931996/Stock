const yahooFinance = require("yahoo-finance2").default;
const cache = require("./cache");
const { HttpsProxyAgent } = require("https-proxy-agent");

const PRICE_CACHE_TTL = 5 * 60; // 5 minutes in seconds for node-cache
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const API_DELAY_MS = 200; // Delay between individual historical data requests to Yahoo Finance

// --- ROTATING PROXY CONFIGURATION ---
// Replace with your actual proxy credentials from a service like Bright Data, ScraperAPI, etc.
const PROXY_CONFIG = {
  host: process.env.PROXY_HOST || "your-proxy-host.com",
  port: process.env.PROXY_PORT || 8080,
  username: process.env.PROXY_USERNAME || "your-proxy-username",
  password: process.env.PROXY_PASSWORD || "your-proxy-password",
};

function getProxyAgent() {
  if (process.env.NODE_ENV !== 'production' || !process.env.PROXY_HOST) {
    return undefined; // Don't use proxy in local development unless configured
  }
  const proxyUrl = `http://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
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
      console.log(`📡 Fetching current price for [${symbolsToFetch.join(", ")}]...`);
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

  // 2. Fetch data for all non-cached symbols in a single batch request
  if (symbolsToFetch.length > 0) {
    // Unlike .quote(), .chart() does not support batching. We must loop.
    for (const symbol of symbolsToFetch) {
      const agent = getProxyAgent(); // Get a new proxy connection for each request
      try {
        console.log(`📡 Fetching historical data for [${symbol}]...`);
        const result = await yahooFinance.chart(
          symbol,
          {
            period1: threeYearsAgo,
            period2: today,
            interval: "1d",
          },
          { fetchOptions: { agent } } // Pass the proxy agent here
        );

        if (result && result.quotes && result.quotes.length > 0) {
          const formatted = result.quotes.map((item) => ({
            symbol,
            date: item.date,
            high: item.high,
            low: item.low,
          }));

          const cacheKey = `historical:${symbol}`;
          cache.set(cacheKey, formatted, HISTORICAL_CACHE_TTL);
          allHistoricalData.push(...formatted);
        } else {
          console.warn(`⚠️ No historical data returned for ${symbol}.`);
          const errorMessage = (result && result.error) ? result.error.message : "No historical data found.";
          errors.push({ symbol, error: errorMessage });
        }

        // Add a small delay between requests to avoid hitting rate limits
        await sleep(API_DELAY_MS);
      } catch (err) {
        console.error(`❌ Error fetching historical data for ${symbol}:`, err);
        errors.push({ symbol, error: "Failed to fetch historical data." });
      }
    }
  }

  // Return both the data and any errors that occurred.
  return { data: allHistoricalData, errors };
}

module.exports = {
  fetchStockData,
  getCurrentPrice,
};
