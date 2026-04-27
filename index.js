require("dotenv").config();
const express = require("express");
const cors = require("cors");

const yahooRoute = require("./routes/yahoo");
const upstoxRoute = require("./routes/upstox");
const strategyRoute = require("./routes/strategy");

// --- GLOBAL PROXY SETUP ---
// yahoo-finance2 v2.13+ uses native Node.js fetch (undici), which does NOT
// support the 'agent' option. We must use undici's setGlobalDispatcher instead.
function setupGlobalProxy() {
  const PROXY_HOST = process.env.PROXY_HOST;
  const PROXY_PORT = process.env.PROXY_PORT;
  const PROXY_USERNAME = process.env.PROXY_USERNAME;
  const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

  if (!PROXY_HOST || !PROXY_PORT || !PROXY_USERNAME || !PROXY_PASSWORD) {
    console.warn("[PROXY] ⚠️  Proxy env vars not set. Yahoo Finance may be blocked on this host.");
    return;
  }

  try {
    const { ProxyAgent, setGlobalDispatcher } = require("undici");
    const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
    const proxyAgent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(proxyAgent);
    console.log(`[PROXY] ✅ Global undici dispatcher set → ${PROXY_HOST}:${PROXY_PORT}`);
  } catch (err) {
    console.error("[PROXY] ❌ Failed to set global proxy dispatcher:", err.message);
  }
}

// Apply proxy before any routes are loaded
setupGlobalProxy();


const app = express();

// Trust the first proxy hop (e.g., from Render's load balancer).
// This is crucial for rate-limiting and getting the correct client IP.
app.set("trust proxy", 1);

const corsOptions = {
  origin: ['https://stock-app-6gu.pages.dev', 'http://localhost:3000'],
  optionsSuccessStatus: 200 // For legacy browser support
};
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use("/api/yahoo", yahooRoute);  // live fetch
app.use("/api/upstox", upstoxRoute); // Upstox options data
app.use("/api/strategy", strategyRoute); // Strategy management

app.get("/", (req, res) => {
  const code = req.query.code;
  
  // Handle Upstox OAuth callback
  if (code) {
    return res.redirect(`/api/upstox/auth-callback?code=${code}`);
  }
  
  res.send("<h2>🚀 Stock API running</h2>");
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
