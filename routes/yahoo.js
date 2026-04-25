const express = require("express");
const { fetchStockData, getCurrentPrice } = require("../lib/fetchStock");
const { getUpstoxClient } = require("../lib/upstox-client");
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

// GET /api/yahoo/nifty
router.get("/nifty", async (req, res) => {
  try {
    console.log("Fetching Nifty 50 price...");
    const results = await getCurrentPrice(["^NSEI"]);
    console.log("Nifty results:", results);
    const niftyData = results.find(result => result.symbol === "^NSEI");

    if (!niftyData || niftyData.error) {
      console.error("Nifty data not found:", niftyData);
      return res.status(404).json({ error: "Nifty 50 price data not found" });
    }

    // Ensure the price is in rupees (INR)
    const responsePayload = {
      symbol: "NIFTY 50",
      price: niftyData.price,
      change: niftyData.change,
      changePercent: niftyData.changePercent,
      currency: "INR",
      lastUpdated: niftyData.time
    };

    console.log("Nifty response:", responsePayload);
    res.json(responsePayload);
  } catch (err) {
    console.error("Error fetching Nifty 50 price:", err);
    res.status(500).json({ error: "An internal server error occurred.", details: err.message });
  }
});

// GET /api/yahoo/options/:symbol - DEPRECATED
// Options are now fetched from Upstox via /api/upstox/* endpoints
router.get("/options/:symbol", async (req, res) => {
  return res.status(410).json({ 
    error: "This endpoint has been deprecated. Use /api/upstox/options-premiums instead.",
    documentation: "https://upstox.com/developer/api-documentation/authentication"
  });
});

// POST /api/yahoo/options/premiums - DEPRECATED
// Options premium data is now fetched from Upstox via /api/upstox/options-premiums
router.post("/options/premiums", async (req, res) => {
  return res.status(410).json({ 
    error: "This endpoint has been deprecated. Use /api/upstox/options-premiums instead.",
    documentation: "https://upstox.com/developer/api-documentation/authentication"
  });
});

module.exports = router;