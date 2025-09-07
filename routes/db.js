const express = require("express");
const Stock = require("../models/Stock");

const router = express.Router();

// Clear all stocks
router.delete("/clear-all", async (req, res) => {
  try {
    await Stock.deleteMany({});
    res.json({ message: "All stock data cleared!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
