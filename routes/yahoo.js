const express = require("express");
const { fetchStockData, getCurrentPrice } = require("../lib/fetchStock");
const cache = require("../lib/cache");

const router = express.Router();

const API_DELAY_MS = 200; // Delay between historical data requests
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generic error handler for API routes.
 */
function handleApiError(err, res, symbol) {
  console.error(`Error processing ${symbol || 'request'}:`, err);
  if (err.message && err.message.includes("Too Many Requests")) {
    return res.status(429).json({ error: "Rate limit hit. Please try again later." });
  }
  if (err.name === 'YFError') {
    return res.status(404).json({ error: `Invalid symbol or no data found for: ${symbol}` });
  }
  res.status(500).json({ error: "An internal server error occurred." });
}

// POST /api/yahoo/prices
router.post("/prices", async (req, res) => {
  const { symbols } = req.body;
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: "Request body must be an array of stock symbols." });
  }

  const uniqueSymbols = [...new Set(symbols.map(s => s.toUpperCase()))];
  const cachedResults = [];
  const symbolsToFetch = [];

  // 1. Check cache first
  for (const symbol of uniqueSymbols) {
    const cacheKey = `price:${symbol}`;
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      cachedResults.push(cachedData);
    } else {
      symbolsToFetch.push(symbol);
    }
  }

  // 2. Fetch non-cached symbols in a single batch
  try {
    let fetchedData = [];
    if (symbolsToFetch.length > 0) {
      const results = await getCurrentPrice(symbolsToFetch);
      fetchedData = Array.isArray(results) ? results : [results];

      // 3. Cache the new results
      for (const item of fetchedData) {
        const cacheKey = `price:${item.symbol}`;
        cache.set(cacheKey, item, PRICE_CACHE_TTL);
      }
    }

    res.json({
      source: "Yahoo Finance",
      data: [...cachedResults, ...fetchedData],
    });
  } catch (err) {
    handleApiError(err, res, symbolsToFetch.join(','));
  }
});

// POST /api/yahoo/historical
router.post("/historical", async (req, res) => {
  const { symbols } = req.body;

  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: "Request body must be an array of stock symbols." });
  }

  const uniqueSymbols = [...new Set(symbols.map(s => s.toUpperCase()))];
  const allData = [];
  const errors = [];

  // Add a small initial delay before starting a large batch of historical requests.
  await sleep(API_DELAY_MS);

  for (const symbol of uniqueSymbols) {
    try {
      // fetchStockData now uses the cache internally
      const data = await fetchStockData(symbol);
      allData.push(...data);
      // Always sleep to ensure we never hit the API too fast, even with a mix of cached/uncached requests.
      await sleep(API_DELAY_MS);
    } catch (err) {
      errors.push({ symbol, error: err.message });
      // If we hit a rate limit, stop processing to avoid making it worse.
      if (err.message && err.message.includes("Too Many Requests")) {
        errors.push({ symbol: "GLOBAL", error: "Rate limit hit. Aborting further requests." });
        break;
      }
    }
  }

  res.json({ source: "Yahoo Finance Bulk", data: allData, errors });
});

module.exports = router;
