require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { HttpsProxyAgent } = require("https-proxy-agent");

const yahooRoute = require("./routes/yahoo");
const upstoxRoute = require("./routes/upstox");
const strategyRoute = require("./routes/strategy");

// --- DIAGNOSTIC FUNCTION ---
async function runProxyDiagnostic() {
  console.log("[DIAGNOSTIC] Running proxy check...");
  const PROXY_HOST = process.env.PROXY_HOST;
  const PROXY_PORT = process.env.PROXY_PORT;
  const PROXY_USERNAME = process.env.PROXY_USERNAME;
  const PROXY_PASSWORD = process.env.PROXY_PASSWORD;

  if (!PROXY_HOST || !PROXY_PORT || !PROXY_USERNAME || !PROXY_PASSWORD) {
    console.log("[DIAGNOSTIC] Proxy environment variables not set. Skipping proxy check.");
    return;
  }

  try {
    const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;
    const agent = new HttpsProxyAgent(proxyUrl);
    const response = await fetch("https://httpbin.org/ip", { agent });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log(`[DIAGNOSTIC] Proxy is active. Outgoing IP address: ${data.origin}`);
  } catch (error) {
    console.error("[DIAGNOSTIC] Error during proxy check:", error.message);
    console.error("[DIAGNOSTIC] This may indicate a problem with the proxy server or network configuration.");
  }
}

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

// Run diagnostics before starting the server
runProxyDiagnostic().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
});
