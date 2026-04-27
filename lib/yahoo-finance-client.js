const yahooFinance = require("yahoo-finance2").default;
const { HttpsProxyAgent } = require("https-proxy-agent");

// Suppress the "Please consider completing the survey" notice from the logs
yahooFinance.suppressNotices(["yahooSurvey"]);

// The User-Agent helps mimic a real browser request.
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.4472.124 Safari/537.36';

/**
 * Creates a proxy agent lazily on each call, reading from process.env.
 * This ensures env vars set by Render are always picked up, even if the
 * module was loaded before the vars were available.
 */
function getProxyAgent() {
  const PROXY_HOST = process.env.PROXY_HOST;
  const PROXY_PORT = process.env.PROXY_PORT;
  const PROXY_USERNAME = process.env.PROXY_USERNAME;
  const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

  if (!PROXY_HOST || !PROXY_PORT || !PROXY_USERNAME || !PROXY_PASSWORD) {
    return undefined;
  }

  const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
  return new HttpsProxyAgent(proxyUrl);
}

// Log proxy status at startup so you can verify on Render logs
const startupProxy = getProxyAgent();
if (startupProxy) {
  console.log(`[PROXY] ✅ Proxy configured: ${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`);
} else {
  console.warn('[PROXY] ⚠️  No proxy configured - Yahoo Finance requests may be blocked on cloud hosts.');
}

// Create a new object to export, wrapping the original yahooFinance functions
const yahooFinanceWithProxy = {};

// List of functions to wrap. Add any other functions you use from the library.
const functionsToWrap = ["quote", "chart", "historical", "search", "recommendationsBySymbol", "trendingSymbols", "options"];

for (const funcName of functionsToWrap) {
  const originalFunc = yahooFinance[funcName];
  if (typeof originalFunc === "function") {
    yahooFinanceWithProxy[funcName] = function(...args) {
      const query = args[0];
      const queryOptions = args.length > 1 ? args[1] : {};
      const moduleOptions = args.length > 2 ? args[2] : {};

      // Get a fresh agent on every call so env vars are always respected
      const agent = getProxyAgent();

      const newFetchOptions = {
        ...(moduleOptions.fetchOptions || {}),
        headers: {
          'User-Agent': userAgent,
          ...(moduleOptions.fetchOptions?.headers || {}),
        },
      };

      if (agent) {
        newFetchOptions.agent = agent;
      } else {
        console.warn(`[PROXY-WARN] No proxy agent for '${funcName}' - request may be blocked.`);
      }

      const newModuleOptions = {
        ...moduleOptions,
        fetchOptions: newFetchOptions,
      };

      return originalFunc.call(yahooFinance, query, queryOptions, newModuleOptions);
    };
  } else {
    yahooFinanceWithProxy[funcName] = originalFunc;
  }
}

// Copy any other properties from the original object
Object.setPrototypeOf(yahooFinanceWithProxy, yahooFinance);

module.exports = { yahooFinance: yahooFinanceWithProxy };