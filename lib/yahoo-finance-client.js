const yahooFinance = require("yahoo-finance2").default;
const { HttpsProxyAgent } = require("https-proxy-agent");

// --- ROTATING PROXY CONFIGURATION ---
// These values should be set in your environment (.env file or hosting provider)
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

function getProxyAgent() {
  if (!PROXY_HOST || !PROXY_PORT || !PROXY_USERNAME || !PROXY_PASSWORD) {
    console.warn('[PROXY] Proxy environment variables not set. Proceeding without proxy.');
    return undefined;
  }

  const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
  console.log(`[PROXY] Using proxy: http://${PROXY_USERNAME}:[REDACTED]@${PROXY_HOST}:${PROXY_PORT}`);
  return new HttpsProxyAgent(proxyUrl);
}

// --- WRAPPER CONFIGURATION ---

// Suppress the "Please consider completing the survey" notice from the logs
yahooFinance.suppressNotices(["yahooSurvey"]);

// Create the agent instance. This will be undefined if ENV vars are not set.
const agent = getProxyAgent();

// The User-Agent helps mimic a real browser request.
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

// Create a new object to export, wrapping the original yahooFinance functions
const yahooFinanceWithProxy = {};

// List of functions to wrap. Add any other functions you use from the library.
const functionsToWrap = ["quote", "chart", "historical", "search", "recommendationsBySymbol", "trendingSymbols", "options"];

for (const funcName of functionsToWrap) {
  const originalFunc = yahooFinance[funcName];
  if (typeof originalFunc === "function") {
    // Define the wrapped function
    yahooFinanceWithProxy[funcName] = function(...args) {
      // The last argument is typically moduleOptions, where fetchOptions should go.
      // We need to handle cases where it's not provided.
      const query = args[0];
      const queryOptions = args.length > 1 ? args[1] : {};
      const moduleOptions = args.length > 2 ? args[2] : {};

      // Prepare new fetchOptions
      const newFetchOptions = {
        ...(moduleOptions.fetchOptions || {}),
        headers: {
          'User-Agent': userAgent,
          ...(moduleOptions.fetchOptions?.headers || {}),
        },
      };

      // Add agent only if it was successfully created
      if (agent) {
        newFetchOptions.agent = agent;
        console.log(`[PROXY-CHECK] Attaching proxy agent to '${funcName}' call.`);
      }

      // Construct the new moduleOptions
      const newModuleOptions = {
        ...moduleOptions,
        fetchOptions: newFetchOptions,
      };

      // Call the original function with the modified arguments
      return originalFunc.call(yahooFinance, query, queryOptions, newModuleOptions);
    };
  } else {
    // If it's not a function, just copy it over.
    yahooFinanceWithProxy[funcName] = originalFunc;
  }
}

// To be safe, copy any other properties from the original object
Object.setPrototypeOf(yahooFinanceWithProxy, yahooFinance);

module.exports = { yahooFinance: yahooFinanceWithProxy };