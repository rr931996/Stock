const { yahooFinance } = require("./yahoo-finance-client");
const cache = require("./cache");
const { withRetry } = require("./api-utils");

const PRICE_CACHE_TTL = 5 * 60; // 5 minutes in seconds for node-cache
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const PRICE_BATCH_SIZE = 10; // Number of symbols to fetch in a single batch
const PRICE_BATCH_DELAY_MS = 500; // Delay between price fetch batches

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Create wrapped, retry-enabled versions of the yahooFinance functions
const quoteWithRetry = withRetry(yahooFinance.quote.bind(yahooFinance));
const chartWithRetry = withRetry(yahooFinance.chart.bind(yahooFinance));

async function getCurrentPrice(symbols) {
  const symbolsToFetch = [];
  const results = {};

  // 1. Check cache for each symbol
  for (const symbol of symbols) {
    const cacheKey = `price:${symbol}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      results[symbol] = cached;
    } else {
      symbolsToFetch.push(symbol);
    }
  }

  // 2. Fetch prices for non-cached symbols in batches
  if (symbolsToFetch.length > 0) {
    console.log(`[FETCH] Current prices for ${symbolsToFetch.length} uncached symbols. Processing in batches of ${PRICE_BATCH_SIZE}.`);

    for (let i = 0; i < symbolsToFetch.length; i += PRICE_BATCH_SIZE) {
      const batch = symbolsToFetch.slice(i, i + PRICE_BATCH_SIZE);
      try {
        const quotes = await quoteWithRetry(batch);

        const quotesBySymbol = quotes.reduce((acc, q) => {
          if (q && q.symbol) acc[q.symbol] = q;
          return acc;
        }, {});

        for (const symbol of batch) {
          const quote = quotesBySymbol[symbol];
          if (quote && quote.regularMarketPrice != null) {
            const priceData = {
              symbol: quote.symbol,
              price: quote.regularMarketPrice,
              change: quote.regularMarketChange,
              changePercent: quote.regularMarketChangePercent,
              time: quote.regularMarketTime,
            };
            results[symbol] = priceData;
            cache.set(`price:${symbol}`, priceData, PRICE_CACHE_TTL);
          } else {
            results[symbol] = { symbol, error: "No price data found" };
          }
        }
      } catch (err) {
        console.error(`❌ Error fetching current prices for batch ${batch.join(", ")}:`, err);
        batch.forEach(symbol => {
          if (!results[symbol]) results[symbol] = { symbol, error: "Failed to fetch price data" };
        });
      }

      if (i + PRICE_BATCH_SIZE < symbolsToFetch.length) {
        await sleep(PRICE_BATCH_DELAY_MS);
      }
    }
  }

  // 4. Return an array of all results
  return Object.values(results);
}

async function fetchStockData(symbols) {
  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);

  const allHistoricalData = [];
  const symbolsToFetch = [];
  const errors = [];
  const backgroundFetchPromises = [];

  // 1. Check cache for each symbol
  for (const symbol of symbols) {
    const cacheKey = `historical:${symbol}`;
    // Use allowStale to get an item even if its TTL has expired.
    const cachedItem = cache.get(cacheKey, { allowStale: true });

    if (cachedItem) {
      allHistoricalData.push(...cachedItem);

      // If cache.has(key) is false, it means the item we just got with
      // allowStale:true is indeed expired. We should trigger a background
      // fetch to update it. We check for staleness by seeing if a normal .get()
      // without allowStale returns undefined.
      if (cache.get(cacheKey) === undefined)
        backgroundFetchPromises.push(fetchAndCacheSingleSymbol(symbol));
    } else {
      symbolsToFetch.push(symbol);
    }
  }

  // 2. Fetch data for all non-cached symbols in a single batch request
  // This is for symbols that were never in the cache. We need to wait for these.
  // We process them in controlled batches to avoid rate-limiting.
  if (symbolsToFetch.length > 0) {
    const BATCH_SIZE = 5; // Process 5 symbols at a time
    const BATCH_DELAY_MS = 1000; // Wait 1 second between batches

    console.log(`[FETCH] Historical data for ${symbolsToFetch.length} uncached symbols. Processing in batches of ${BATCH_SIZE}.`);

    for (let i = 0; i < symbolsToFetch.length; i += BATCH_SIZE) {
      const batch = symbolsToFetch.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(symbol => fetchAndCacheSingleSymbol(symbol));
      const settledResults = await Promise.allSettled(batchPromises);

      settledResults.forEach((res, index) => {
        if (res.status === 'fulfilled' && res.value) {
          allHistoricalData.push(...res.value);
        } else if (res.status === 'rejected') {
          const symbol = batch[index];
          errors.push({ symbol, error: res.reason.message || "Failed to fetch historical data." });
        }
      });

      // Wait before processing the next batch, if there is one
      if (i + BATCH_SIZE < symbolsToFetch.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }
  }

  // Don't wait for background fetches to complete before responding.
  // This is a "fire and forget" operation.
  Promise.allSettled(backgroundFetchPromises).then(results => {
    results.forEach((res, i) => {
      if (res.status === 'rejected') {
        // Log background errors, but don't crash the server.
        console.error(`Background fetch failed for stale cache:`, res.reason);
      }
    });
  });

  // Return the immediately available data (cached or freshly fetched).
  return { data: allHistoricalData, errors };
}

async function fetchAndCacheSingleSymbol(symbol) {
  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);

  const result = await chartWithRetry(
    symbol, { period1: threeYearsAgo, period2: today, interval: "1d" }
  );

  if (result && result.quotes && result.quotes.length > 0) {
    const formatted = result.quotes.map((item) => ({
      symbol,
      date: item.date,
      high: item.high,
      low: item.low,
    }));
    cache.set(`historical:${symbol}`, formatted, HISTORICAL_CACHE_TTL);
    return formatted;
  } else {
    // Add a small delay even on failure to avoid hammering the API on repeated bad requests
    await sleep(API_DELAY_MS);
    const errorMessage = (result && result.error) ? result.error.message : `No historical data found for ${symbol}.`;
    throw new Error(errorMessage);
  }
}

module.exports = {
  fetchStockData,
  getCurrentPrice,
};