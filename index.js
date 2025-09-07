require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const yahooFinance = require("yahoo-finance2").default;
const cron = require("node-cron");
const cors = require("cors");

const app = express();

// Enable CORS & JSON parsing
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ Connected to MongoDB Atlas"))
.catch((err) => console.error("❌ MongoDB connection error:", err));

// Stock Schema & Model
const stockSchema = new mongoose.Schema({
  symbol: String,
  date: Date,
  high: Number,
  low: Number,
});
const Stock = mongoose.model("Stock", stockSchema);

// Example NIFTY 50 (can expand to NIFTY 500 later)
const nifty500Stocks = [
  { symbol: "ADANIENT.NS", name: "Adani Enterprises Ltd" },
  { symbol: "ADANIPORTS.NS", name: "Adani Ports & SEZ Ltd" },
  { symbol: "APOLLOHOSP.NS", name: "Apollo Hospitals Enterprise Ltd" },
  { symbol: "ASIANPAINT.NS", name: "Asian Paints Ltd" },
  { symbol: "AXISBANK.NS", name: "Axis Bank Ltd" },
  { symbol: "BAJAJ-AUTO.NS", name: "Bajaj Auto Ltd" },
  { symbol: "BAJFINANCE.NS", name: "Bajaj Finance Ltd" },
  { symbol: "BAJAJFINSV.NS", name: "Bajaj Finserv Ltd" },
  { symbol: "BEL.NS", name: "Bharat Electronics Ltd" },
  { symbol: "BHARTIARTL.NS", name: "Bharti Airtel Ltd" },
  // Add all other NIFTY 500 stocks here
];

// Extract symbols for historical fetch
const stockSymbols = nifty500Stocks.map(stock => stock.symbol);

// Fetch & Save Stock Data
async function fetchStockData(symbol) {
  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);

  try {
    const history = await yahooFinance.historical(symbol, {
      period1: threeYearsAgo,
      period2: today,
      interval: "1d",
    });

    const formatted = history.map((item) => ({
      symbol,
      date: item.date,
      high: item.high,
      low: item.low,
    }));

    await Stock.deleteMany({ symbol }); // Replace old data
    await Stock.insertMany(formatted);

    console.log(`✅ Updated: ${symbol} (${formatted.length} records)`);
  } catch (err) {
    console.error(`❌ Error fetching ${symbol}:`, err.message);
  }
}

// ------------------ ROUTES ------------------

// Root route - simple welcome message
app.get("/", (req, res) => {
  res.send("<h2>🚀 API Server is running successfully on port 3000</h2>");
});

// Fetch all stock data from DB
app.get("/api/db/stocks", async (req, res) => {
  try {
    const data = await Stock.find().sort({ symbol: 1, date: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stock data from DB" });
  }
});

// DELETE all stock data
app.delete("/api/db/clear-all", async (req, res) => {
  try {
    const result = await Stock.deleteMany({});
    console.log(`🗑️ Deleted ALL stock data (${result.deletedCount} records)`);
    res.json({ message: "Deleted ALL stock data", deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete all stock data" });
  }
});

// DELETE stock by symbol
app.delete("/api/stocks/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const result = await Stock.deleteMany({ symbol });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: `No data found for ${symbol}` });
    }
    res.json({ message: `Deleted data for ${symbol}`, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete stock data" });
  }
});

// Fetch & save all stocks (from Yahoo)
app.get("/api/stocks", async (req, res) => {
  try {
    let data = await Stock.find().sort({ symbol: 1, date: -1 });
    if (data.length === 0) {
      for (const symbol of stockSymbols) {
        await fetchStockData(symbol);
      }
      data = await Stock.find().sort({ symbol: 1, date: -1 });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch all stock data" });
  }
});

// Fetch single stock
app.get("/api/stocks/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    let data = await Stock.find({ symbol }).sort({ date: -1 });
    if (data.length === 0) {
      await fetchStockData(symbol);
      data = await Stock.find({ symbol }).sort({ date: -1 });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stock data" });
  }
});

// New API – return list of stock symbol + name
app.get("/api/stocks/list", (req, res) => {
  try {
    const stockList = nifty500Stocks.map(stock => ({
      symbol: stock.symbol,
      name: stock.name,
    }));
    res.json(stockList);
  } catch (err) {
    console.error("❌ Failed to fetch stock list:", err.message);
    res.status(500).json({ error: "Failed to fetch stock list" });
  }
});

// ------------------ CRON JOB ------------------

// Cron job – refresh stocks daily at 9:30 PM IST
cron.schedule("30 15 * * *", async () => {
  console.log("⏳ Refreshing all stock data sequentially...");
  for (const symbol of stockSymbols) {
    await fetchStockData(symbol);
  }
  console.log("🎉 All stock data refreshed by cron!");
});

// ------------------ START SERVER ------------------
app.listen(3000, () => console.log("🚀 API running at http://localhost:3000"));
