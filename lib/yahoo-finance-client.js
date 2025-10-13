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

module.exports = { yahooFinance, getProxyAgent };