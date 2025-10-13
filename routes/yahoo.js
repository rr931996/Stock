const express = require("express");
const { fetchStockData, getCurrentPrice } = require("../lib/fetchStock");
const cache = require("../lib/cache");
const router = express.Router();

// POST /api/yahoo/prices
router.post("/prices", async (req, res) => {
  const { symbols } = req.body;
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res
      .status(400)
      .json({ error: "Request body must be an array of stock symbols." });
  }

  const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];

  try {
    const results = await getCurrentPrice(uniqueSymbols);

    // Log cache hits for observability
    const cacheHits = uniqueSymbols.filter(
      (symbol) => cache.get(`price:${symbol}`) !== undefined
    );
    if (cacheHits.length > 0) {
      console.log(`[CACHE] Hit for symbols: ${cacheHits.join(", ")}`);
    }

    const responsePayload = { source: "Yahoo Finance", data: results };
  
    res.json(responsePayload);
  } catch (err) {
    console.error(`Error processing /prices for ${uniqueSymbols.join(", ")}:`, err);
    // The withRetry utility will have already handled 429s.
    // Any error reaching this point is either a different kind of API error
    // or a genuine internal server error.
    res.status(500).json({ error: "An internal server error occurred.", details: err.message });
  }
});

// POST /api/yahoo/historical
router.post("/historical", async (req, res) => {
  const { symbols } = req.body;

  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res
      .status(400)
      .json({ error: "Request body must be an array of stock symbols." });
  }

  const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];

  try {
    const { data, errors } = await fetchStockData(uniqueSymbols);
    const responsePayload = { source: "Yahoo Finance Bulk", data, errors };

    res.json(responsePayload);
  } catch (err) {
    console.error(`Error processing /historical for ${uniqueSymbols.join(", ")}:`, err);
    // The withRetry utility will have already handled 429s.
    // Any error reaching this point is a genuine internal server error.
    res.status(500).json({ error: "An internal server error occurred.", details: err.message });
  }
});

module.exports = router;