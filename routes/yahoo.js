const express = require("express");
const { fetchStockData, getCurrentPrice } = require("../lib/fetchStock");

const router = express.Router();

// GET live stock from Yahoo and store in DB
// GET historical data from Yahoo and store in DB
router.get("/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await fetchStockData(symbol.toUpperCase());
    res.json({ source: "Yahoo Finance", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET current price for a symbol
router.get("/price/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await getCurrentPrice(symbol.toUpperCase());
    res.json({ source: "Yahoo Finance", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
