const { yahooFinance } = require("./yahoo-finance-client");
const cache = require("./cache");
const { withRetry } = require("./api-utils");
const axios = require("axios");

const PRICE_CACHE_TTL = 5 * 60; // 5 minutes in seconds for node-cache
const HISTORICAL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const PRICE_BATCH_SIZE = 10; // Number of symbols to fetch in a single batch
const PRICE_BATCH_DELAY_MS = 500; // Delay between price fetch batches
const API_DELAY_MS = 500; // General delay for API calls, especially on failure
const OPTIONS_CACHE_TTL = 30 * 60 * 1000; // Cache option chains for 30 minutes
const NSE_BASE_URL = "https://www.nseindia.com";

const normalizeNseSymbol = (symbol) =>
  String(symbol || "").trim().replace(/\.NS$/i, "").toUpperCase();

const buildYahooSymbolVariants = (symbol) => {
  const normalized = normalizeNseSymbol(symbol);
  return [...new Set([`${normalized}.NS`, normalized])];
};

const findQuoteForSymbol = (quotesBySymbol, symbol) => {
  const normalizedTarget = normalizeNseSymbol(symbol);
  return Object.values(quotesBySymbol).find(
    (q) => q && q.symbol && normalizeNseSymbol(q.symbol) === normalizedTarget
  );
};
const NSE_API_URL = `${NSE_BASE_URL}/api/option-chain-indices?symbol=NIFTY`;
const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Referer": "https://www.nseindia.com/option-chain",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Create wrapped, retry-enabled versions of the yahooFinance functions
const quoteWithRetry = withRetry(yahooFinance.quote.bind(yahooFinance));
const chartWithRetry = withRetry(yahooFinance.chart.bind(yahooFinance));
const optionsWithRetry = withRetry(yahooFinance.options.bind(yahooFinance));

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

        const quotesBySymbol = (Array.isArray(quotes) ? quotes : [quotes]).reduce((acc, q) => {
          if (q && q.symbol) acc[q.symbol] = q;
          return acc;
        }, {});

        for (const symbol of batch) {
          let quote = findQuoteForSymbol(quotesBySymbol, symbol);

          if (!quote || quote.regularMarketPrice == null) {
            for (const candidate of buildYahooSymbolVariants(symbol)) {
              if (candidate === symbol) continue;
              try {
                const retryQuote = await quoteWithRetry(candidate);
                if (retryQuote && retryQuote.regularMarketPrice != null) {
                  quote = retryQuote;
                  break;
                }
              } catch (_) {
                // ignore and try next variant
              }
            }
          }

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
        for (const symbol of batch) {
          const variants = buildYahooSymbolVariants(symbol);
          let resolved = false;
          for (const candidate of variants) {
            if (candidate === symbol) continue;
            try {
              const retryQuote = await quoteWithRetry(candidate);
              if (retryQuote && retryQuote.regularMarketPrice != null) {
                const priceData = {
                  symbol: retryQuote.symbol,
                  price: retryQuote.regularMarketPrice,
                  change: retryQuote.regularMarketChange,
                  changePercent: retryQuote.regularMarketChangePercent,
                  time: retryQuote.regularMarketTime,
                };
                results[symbol] = priceData;
                cache.set(`price:${symbol}`, priceData, PRICE_CACHE_TTL);
                resolved = true;
                break;
              }
            } catch (_) {
              // ignore and try next variant
            }
          }
          if (!resolved) {
            results[symbol] = { symbol, error: "Failed to fetch price data" };
          }
        }
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

  let result = null;
  try {
    result = await chartWithRetry(
      symbol, { period1: threeYearsAgo, period2: today, interval: "1d" }
    );
  } catch (firstErr) {
    const alternatives = buildYahooSymbolVariants(symbol).filter((alt) => alt !== symbol);
    for (const alt of alternatives) {
      try {
        result = await chartWithRetry(
          alt, { period1: threeYearsAgo, period2: today, interval: "1d" }
        );
        if (result && result.quotes && result.quotes.length > 0) {
          break;
        }
      } catch (_err) {
        // ignore and try next variant
      }
    }
  }

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

async function fetchNseOptionChain() {
  const cacheKey = `nse:optionChain`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Create axios instance with session cookie support
    const axiosInstance = axios.create({
      withCredentials: true,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    // Step 1: Get session cookie from NSE homepage
    console.log('[NSE] Priming session with homepage...');
    await axiosInstance.get('https://www.nseindia.com', { timeout: 10000 });
    console.log('[NSE] Session cookie obtained');

    // Step 2: Fetch option chain
    console.log('[NSE] Fetching option chain data...');
    const apiUrl = 'https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY';
    const response = await axiosInstance.get(apiUrl, { timeout: 10000 });

    const data = response.data;
    if (!data || !data.records || !Array.isArray(data.records.data)) {
      throw new Error('Invalid NSE response structure');
    }

    console.log(`[NSE] Received ${data.records.data.length} strikes`);

    // Step 3: Transform NSE data to match our expected format
    // NSE returns: { strikePrice, CE: { lastPrice, ... }, PE: { lastPrice, ... } }
    // We need: { calls: [...], puts: [...] }
    const formatted = {
      optionChain: {
        result: [
          {
            options: [
              {
                calls: data.records.data
                  .filter((item) => item.CE && item.CE.lastPrice)
                  .map((item) => ({
                    ...item.CE,
                    strike: item.strikePrice,
                    lastPrice: item.CE.lastPrice,
                    bid: item.CE.bidPrice,
                    ask: item.CE.askPrice,
                  })),
                puts: data.records.data
                  .filter((item) => item.PE && item.PE.lastPrice)
                  .map((item) => ({
                    ...item.PE,
                    strike: item.strikePrice,
                    lastPrice: item.PE.lastPrice,
                    bid: item.PE.bidPrice,
                    ask: item.PE.askPrice,
                  })),
              },
            ],
          },
        ],
      },
    };

    console.log(`[NSE] Parsed ${formatted.optionChain.result[0].options[0].calls.length} calls and ${formatted.optionChain.result[0].options[0].puts.length} puts`);

    cache.set(cacheKey, formatted, OPTIONS_CACHE_TTL);
    return formatted;

  } catch (err) {
    console.error('[NSE] Error fetching option chain:', err.message);
    throw err;
  }
}

async function fetchOptionsData(symbol) {
  const cacheKey = `options:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const result = await optionsWithRetry(symbol);
    const chain = result?.optionChain?.result?.[0]?.options?.[0];
    if (result && chain && (chain.calls?.length || chain.puts?.length)) {
      cache.set(cacheKey, result, OPTIONS_CACHE_TTL);
      return result;
    }

    console.warn(`Yahoo options chain empty or unavailable for ${symbol}`);
    // Return empty structure to gracefully handle missing data
    return {
      optionChain: {
        result: [{ options: [{ calls: [], puts: [] }] }],
      },
    };
  } catch (err) {
    console.error(
      `Options fetch failed for ${symbol}:`,
      err.message || err,
      "Frontend will display '-Rs' for premium prices."
    );
    // Return empty structure to gracefully handle errors
    return {
      optionChain: {
        result: [{ options: [{ calls: [], puts: [] }] }],
      },
    };
  }
}

module.exports = {
  fetchStockData,
  getCurrentPrice,
  fetchOptionsData,
};