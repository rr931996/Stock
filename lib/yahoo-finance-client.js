const yahooFinance = require("yahoo-finance2").default;
const { HttpsProxyAgent } = require("https-proxy-agent");

// --- ROTATING PROXY CONFIGURATION ---
// These values should be set in your environment (.env file or hosting provider)
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USERNAME = process.env.PROXY_USERNAME;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

let agent;

function getProxyAgent() {
  // Singleton pattern: create the agent only once.
  if (agent) return agent;

  if (!PROXY_HOST || !PROXY_PORT || !PROXY_USERNAME || !PROXY_PASSWORD) {
    return undefined; // No proxy configured
  }

  console.log(`[PROXY] Creating shared proxy agent for ${PROXY_HOST}:${PROXY_PORT}`);
  const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
  agent = new HttpsProxyAgent(proxyUrl);
  return agent;
}

// Suppress the "Please consider completing the survey" notice from the logs
yahooFinance.suppressNotices(["yahooSurvey"]);

// --- GLOBAL PROXY CONFIGURATION ---
// This is the definitive fix. By setting the agent globally using setGlobalConfig,
// we ensure that ALL requests made by yahoo-finance2, including the initial
// "getCrumb" request, use the proxy. This avoids IP blocks.
getProxyAgent(); // This call initializes the module-scoped 'agent' variable.

if (agent) {
  // The library's setGlobalConfig has a bug that causes a crash.
  // We'll revert to the direct assignment of the internal _config property,
  // but first, we'll ensure _config is initialized to prevent the original error.
  if (!yahooFinance._config) yahooFinance._config = {};
  yahooFinance._config.fetchOptions = { agent };
  console.log('[PROXY] Global proxy agent has been configured.');

  // --- WORKAROUND: PRIME THE CONNECTION ---
  // By making a harmless, fire-and-forget request here, we force yahoo-finance2
  // to fetch its auth crumb *using the proxy*. This should prevent the
  // "Failed to get crumb" error on subsequent, real requests.
  console.log('[PROXY] Priming connection to cache the auth crumb via proxy...');
  yahooFinance.quote('AAPL').catch((err) => {
    // We ignore the result. The goal is only to trigger the internal auth.
    // A failure here is okay, as the main retry logic will handle subsequent requests.
    console.log('[PROXY] Priming request finished.');
  });
}
module.exports = { yahooFinance, getProxyAgent };