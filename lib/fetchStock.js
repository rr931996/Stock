const yahooFinance = require("yahoo-finance2").default;
const Stock = require("../models/Stock");

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

    // Save in DB
    await Stock.deleteMany({ symbol });
    await Stock.insertMany(formatted);

    console.log(`✅ Updated: ${symbol} (${formatted.length} records)`);
    return formatted;
  } catch (err) {
    console.error(`❌ Error fetching ${symbol}:`, err.message);
    throw err;
  }
}

module.exports = fetchStockData;
