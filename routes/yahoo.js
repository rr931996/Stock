const express = require("express");
const rateLimit = require("express-rate-limit");
const { fetchStockData, getCurrentPrice } = require("../lib/fetchStock");
const cache = require("../lib/cache");

const router = express.Router();

// Apply a rate limiter to all requests to this router
// This helps prevent abuse and reduces the chance of hitting upstream rate limits.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Generic error handler for API routes.
 */
function handleApiError(err, res, symbol) {
  if (err.message && err.message.includes("Too Many Requests")) {
    return res
      .status(429)
      .json({ error: "Rate limit hit. Please try again later." });
  }
  if (err.name === "YFError") {
    return res
      .status(404)
      .json({ error: `Invalid symbol or no data found for: ${symbol}` });
  }
  console.error(`Error processing ${symbol || "request"}:`, err);
  res.status(500).json({ error: "An internal server error occurred." });
}

// POST /api/yahoo/prices
router.post("/prices", apiLimiter, async (req, res) => {
  console.log(
    `➡️  [${new Date().toISOString()}] Received /prices request with symbols:`,
    req.body.symbols
  );
  const { symbols } = req.body;
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res
      .status(400)
      .json({ error: "Request body must be an array of stock symbols." });
  }

  const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];

  try {
    // getCurrentPrice now handles caching internally
    const results = await getCurrentPrice(uniqueSymbols);

    // Log cache hits for observability
    const cacheHits = uniqueSymbols.filter(
      (symbol) => cache.get(`price_${symbol}`) !== undefined
    );
    if (cacheHits.length > 0) {
      console.log(`[CACHE HIT] for symbols: ${cacheHits.join(", ")}`);
    }

    res.json({ source: "Yahoo Finance", data: results });
  } catch (err) {
    const symbolString = Array.isArray(uniqueSymbols) ? uniqueSymbols.join(", ") : uniqueSymbols;
    handleApiError(err, res, symbolString);
  }
});

// POST /api/yahoo/historical
router.post("/historical", async (req, res) => {
  console.log(
    `➡️  [${new Date().toISOString()}] Received /historical request with symbols:`,
    req.body.symbols
  );
  const { symbols } = req.body;

  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res
      .status(400)
      .json({ error: "Request body must be an array of stock symbols." });
  }

  const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];

  // Refactor: Fetch all historical data in a single batch request
  // instead of looping. This is much more efficient and reduces API calls.
  // The `fetchStockData` function would need to be adapted to handle an array of symbols
  // and manage its internal caching logic accordingly.
  // For now, let's assume `fetchStockData` is updated to accept an array.
  try {
    // Assuming fetchStockData is modified to accept an array of symbols
    // and returns a flat array of all historical data points.
    // fetchStockData now returns an object { data, errors }
    const { data, errors } = await fetchStockData(uniqueSymbols);
    res.json({ source: "Yahoo Finance Bulk", data, errors });
  } catch (err) {
    // If the fetchStockData function itself throws a major error (like a full timeout),
    // this will catch it.
    // The generic error handler can now handle batch failures.
    // We pass the array of symbols that failed.
    handleApiError(err, res, uniqueSymbols.join(", "));
  }
});

module.exports = router;
