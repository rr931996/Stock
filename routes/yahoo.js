const express = require("express");
const { fetchStockData, getCurrentPrice } = require("../lib/fetchStock");
const { getUpstoxClient } = require("../lib/upstox-client");
const { fetchUpstoxCurrentPrices, fetchUpstoxHistoricalData } = require("../lib/upstox-market-data");
const cache = require("../lib/cache");
const router = express.Router();

const getFailedPriceSymbols = (symbols, results = []) => {
  const resultsBySymbol = new Map(results.map((item) => [item.symbol, item]));
  return symbols.filter((symbol) => {
    const item = resultsBySymbol.get(symbol);
    return !item || item.error || item.price == null;
  });
};

const mergePriceResults = (symbols, yahooResults = [], upstoxResults = []) => {
  const yahooBySymbol = new Map(yahooResults.map((item) => [item.symbol, item]));
  const upstoxBySymbol = new Map(upstoxResults.map((item) => [item.symbol, item]));

  return symbols.map((symbol) => {
    const yahooItem = yahooBySymbol.get(symbol);
    if (yahooItem && !yahooItem.error && yahooItem.price != null) {
      return yahooItem;
    }

    return upstoxBySymbol.get(symbol) || yahooItem || { symbol, error: "No price data found" };
  });
};

const getSymbolsMissingHistoricalData = (symbols, data = [], errors = []) => {
  const symbolsWithData = new Set(data.map((item) => item.symbol));
  const symbolsWithErrors = new Set(errors.map((item) => item.symbol));

  return symbols.filter((symbol) => !symbolsWithData.has(symbol) || symbolsWithErrors.has(symbol));
};

// GET /api/yahoo/test-proxy - Diagnose proxy and Yahoo Finance connectivity
router.get("/test-proxy", async (req, res) => {
  const PROXY_HOST = process.env.PROXY_HOST;
  const PROXY_PORT = process.env.PROXY_PORT;
  const PROXY_USERNAME = process.env.PROXY_USERNAME;
  const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

  const proxyConfigured = !!(PROXY_HOST && PROXY_PORT && PROXY_USERNAME && PROXY_PASSWORD);
  const result = {
    proxyConfigured,
    proxyHost: PROXY_HOST || "NOT SET",
    proxyPort: PROXY_PORT || "NOT SET",
    proxyUser: PROXY_USERNAME ? PROXY_USERNAME.substring(0, 20) + "..." : "NOT SET",
    undiciAvailable: false,
    globalDispatcherSet: false,
    yahooRawError: null,
    yahooTest: null,
  };

  // Check if undici is available and if global dispatcher is set
  try {
    const undici = require("undici");
    result.undiciAvailable = true;
    result.globalDispatcherSet = !!(undici.getGlobalDispatcher && undici.getGlobalDispatcher()?.constructor?.name !== 'Agent');
  } catch (e) {
    result.undiciAvailable = false;
    result.undiciError = e.message;
  }

  // Directly call yahoo-finance2 to capture the real underlying error
  try {
    const yahooFinance = require("yahoo-finance2").default;
    yahooFinance.suppressNotices(["yahooSurvey"]);
    const quote = await yahooFinance.quote("TCS.NS");
    if (quote && quote.regularMarketPrice) {
      result.yahooTest = { success: true, price: quote.regularMarketPrice };
    } else {
      result.yahooTest = { success: false, quoteReturned: JSON.stringify(quote).substring(0, 200) };
    }
  } catch (err) {
    // Surface the full error cause chain - "fetch failed" hides the real reason
    result.yahooRawError = err.message;
    result.yahooRealCause = err.cause?.message || err.cause?.code || String(err.cause) || "no cause";
    result.yahooErrorCode = err.cause?.code || null;
    result.yahooTest = { success: false };
  }

  res.json(result);
});


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
    let results = await getCurrentPrice(uniqueSymbols);
    const failedSymbols = getFailedPriceSymbols(uniqueSymbols, results);
    let usedUpstoxFallback = false;

    if (failedSymbols.length > 0) {
      try {
        console.warn(`[Yahoo] Price data missing for ${failedSymbols.join(", ")}. Trying Upstox fallback.`);
        const upstoxResults = await fetchUpstoxCurrentPrices(failedSymbols);
        results = mergePriceResults(uniqueSymbols, results, upstoxResults);
        usedUpstoxFallback = upstoxResults.some((item) => item.price != null);
      } catch (fallbackErr) {
        console.error(`[Upstox Fallback] Price fallback failed for ${failedSymbols.join(", ")}:`, fallbackErr.message);
      }
    }

    // Log cache hits for observability
    const cacheHits = uniqueSymbols.filter(
      (symbol) => cache.get(`price:${symbol}`) !== undefined
    );
    if (cacheHits.length > 0) {
      console.log(`[CACHE] Hit for symbols: ${cacheHits.join(", ")}`);
    }

    const responsePayload = {
      source: usedUpstoxFallback ? "Yahoo Finance + Upstox fallback" : "Yahoo Finance",
      data: results
    };
  
    res.json(responsePayload);
  } catch (err) {
    console.error(`Error processing /prices for ${uniqueSymbols.join(", ")}:`, err);
    try {
      const upstoxResults = await fetchUpstoxCurrentPrices(uniqueSymbols);
      return res.json({ source: "Upstox fallback", data: mergePriceResults(uniqueSymbols, [], upstoxResults) });
    } catch (fallbackErr) {
      console.error(`[Upstox Fallback] Price fallback failed after Yahoo error:`, fallbackErr.message);
      res.status(500).json({ error: "An internal server error occurred.", details: err.message });
    }
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
    let { data, errors } = await fetchStockData(uniqueSymbols);
    const failedSymbols = getSymbolsMissingHistoricalData(uniqueSymbols, data, errors);
    let usedUpstoxFallback = false;

    if (failedSymbols.length > 0) {
      try {
        console.warn(`[Yahoo] Historical data missing for ${failedSymbols.join(", ")}. Trying Upstox fallback.`);
        const fallback = await fetchUpstoxHistoricalData(failedSymbols);
        const fallbackSymbols = new Set(fallback.data.map((item) => item.symbol));

        data = [
          ...data.filter((item) => !fallbackSymbols.has(item.symbol)),
          ...fallback.data
        ];
        errors = [
          ...errors.filter((item) => !fallbackSymbols.has(item.symbol)),
          ...fallback.errors
        ];
        usedUpstoxFallback = fallback.data.length > 0;
      } catch (fallbackErr) {
        console.error(`[Upstox Fallback] Historical fallback failed for ${failedSymbols.join(", ")}:`, fallbackErr.message);
      }
    }

    const responsePayload = {
      source: usedUpstoxFallback ? "Yahoo Finance Bulk + Upstox fallback" : "Yahoo Finance Bulk",
      data,
      errors
    };

    res.json(responsePayload);
  } catch (err) {
    console.error(`Error processing /historical for ${uniqueSymbols.join(", ")}:`, err);
    try {
      const fallback = await fetchUpstoxHistoricalData(uniqueSymbols);
      return res.json({ source: "Upstox fallback", data: fallback.data, errors: fallback.errors });
    } catch (fallbackErr) {
      console.error(`[Upstox Fallback] Historical fallback failed after Yahoo error:`, fallbackErr.message);
      res.status(500).json({ error: "An internal server error occurred.", details: err.message });
    }
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
