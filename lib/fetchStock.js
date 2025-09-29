const yahooFinance = require("yahoo-finance2").default;
const cache = require("./cache");

const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCurrentPrice(symbol) {
  // The library can take a single symbol or an array of symbols
  try {
    const quote = await yahooFinance.quote(symbol);

    // If it's an array, the result is an array. If single, it's an object.
    if (Array.isArray(quote)) {
      return quote.map(q => ({
        symbol: q.symbol,
        price: q.regularMarketPrice,
        change: q.regularMarketChange,
        changePercent: q.regularMarketChangePercent,
        time: q.regularMarketTime
      }));
    }

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

  const cacheKey = `historical:${symbol}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return cachedData;
  }

  try {
    const chart = await yahooFinance.chart(symbol, {
      period1: threeYearsAgo,
      period2: today,
      interval: "1d",
    });
    const history = chart.quotes;

    const formatted = history.map((item) => ({
      symbol,
      date: item.date,
      high: item.high,
      low: item.low,
    }));

    cache.set(cacheKey, formatted, HISTORICAL_CACHE_TTL);

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