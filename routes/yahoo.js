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

/**
 * Wraps an async function with retry logic and exponential backoff.
 * @param {Function} fn The async function to call.
 * @param {Array} args Arguments to pass to the function.
 * @param {number} maxRetries Maximum number of retries.
 * @param {number} initialDelay Initial delay in ms for backoff.
 * @returns {Promise<any>}
 */
async function fetchWithRetry(fn, args, maxRetries = 3, initialDelay = 1000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.message?.includes("Too Many Requests") && attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.warn(`Rate limit hit for ${args[0]}. Retrying in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
      } else {
        throw err; // Re-throw if not a rate limit error or if retries are exhausted.
      }
    }
  }
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
      // Use the retry wrapper for the API call.
      const results = await fetchWithRetry(getCurrentPrice, [symbolsToFetch]);
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
      // Use the retry wrapper for the API call.
      // fetchStockData already uses the cache, so this only retries on cache misses.
      const data = await fetchWithRetry(fetchStockData, [symbol]);
      allData.push(...data);
    } catch (err) {
      errors.push({ symbol, error: err.message });
      // If we hit a rate limit, stop processing to avoid making it worse.
      if (err.message && err.message.includes("Too Many Requests")) {
        errors.push({ symbol: "GLOBAL", error: "Rate limit hit. Aborting further requests." });
        break;
      }
    }
  }

  // The original sleep is removed from the loop as the retry logic now handles delays on failure.
  // You could keep a smaller, consistent delay here if you want to be extra cautious even on successful calls.

  res.json({ source: "Yahoo Finance Bulk", data: allData, errors });
});

module.exports = router;
