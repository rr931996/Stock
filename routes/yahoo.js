const express = require("express");
const { fetchStockData, getCurrentPrice } = require("../lib/fetchStock");

const router = express.Router();

// GET current price from Yahoo
router.get("/price/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await getCurrentPrice(symbol.toUpperCase());
    res.json({ source: "Yahoo Finance", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET live stock from Yahoo and store in DB
router.get("/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const data = await fetchStockData(symbol.toUpperCase());
    res.json({ source: "Yahoo Finance", data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
