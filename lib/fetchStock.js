const yahooFinance = require("yahoo-finance2").default;
const Stock = require("../models/Stock");

async function getCurrentPrice(symbol) {
  try {
    const quote = await yahooFinance.quote(symbol);
    return {
      symbol: symbol,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      time: quote.regularMarketTime
    };
  } catch (err) {
    console.error(`❌ Error fetching current price for ${symbol}:`, err.message);
    throw err;
  }
}

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

module.exports = {
  fetchStockData,
  getCurrentPrice
};
