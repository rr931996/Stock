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
    console.error('[DIAGNOSTIC] At least one proxy environment variable is missing.');
    return undefined; // No proxy configured
  }

  // Log the constructed URL for verification, redacting the password.
  const redactedProxyUrl = `http://${PROXY_USERNAME}:[REDACTED]@${PROXY_HOST}:${PROXY_PORT}`;
  console.log(`[DIAGNOSTIC] Using proxy URL: ${redactedProxyUrl}`);

  const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
  agent = new HttpsProxyAgent(proxyUrl);
  return agent;
}

// Suppress the "Please consider completing the survey" notice from the logs
yahooFinance.suppressNotices(["yahooSurvey"]);

// --- GLOBAL PROXY CONFIGURATION ---
getProxyAgent(); // This call initializes the module-scoped 'agent' variable.

if (agent) {
  // The library's setGlobalConfig has a bug that causes a crash, so we directly
  // assign the fetchOptions to the internal _config object.
  if (!yahooFinance._config) yahooFinance._config = {};
  yahooFinance._config.fetchOptions = { agent };
  console.log('[PROXY] Global proxy agent has been configured.');
}
module.exports = { yahooFinance, getProxyAgent };