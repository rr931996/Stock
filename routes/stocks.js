const express = require("express");
// const Stock = require("../models/Stock"); // No longer using the database model

const router = express.Router();

// --- Database-dependent routes are now deprecated ---
// These routes read from MongoDB, which is being removed to make the server stateless.
// The active routes are in `routes/yahoo.js`, which fetch data on-demand.

// // GET all stocks (paginated)
// router.get("/", async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 500;
//     const skip = (page - 1) * limit;
//
//     const stocks = await Stock.find()
//       .sort({ symbol: 1, date: -1 })
//       .skip(skip)
//       .limit(limit);
//
//     const total = await Stock.countDocuments();
//
//     res.json({
//       page,
//       limit,
//       total,
//       totalPages: Math.ceil(total / limit),
//       data: stocks,
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
//
// // GET single stock by symbol
// router.get("/:symbol", async (req, res) => {
//   try {
//     const { symbol } = req.params;
//     const stocks = await Stock.find({ symbol: symbol.toUpperCase() }).sort({ date: -1 });
//
//     if (!stocks.length) return res.status(404).json({ error: "No data found in DB" });
//
//     res.json({ source: "MongoDB", data: stocks });
//   } catch (err) {
    // res.status(500).json({ error: err.message });
//   }
// });
//
// // DELETE all stock data from DB
// router.delete("/", async (req, res) => {
//   try {
//     const result = await Stock.deleteMany({});
//     res.json({ message: "✅ All stock data cleared!", deletedCount: result.deletedCount });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

module.exports = router;
