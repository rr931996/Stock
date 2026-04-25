require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();

// Get config from your .env
const apiKey = process.env.UPSTOX_API_KEY;
const apiSecret = process.env.UPSTOX_API_SECRET;
const redirectUri = process.env.UPSTOX_REDIRECT_URI || "http://localhost:5001";

// Extract the port from the redirect URI, fallback to 5001
const PORT = new URL(redirectUri).port || 5001;
const REDIRECT_PATH = new URL(redirectUri).pathname || "/";

if (!apiKey || !apiSecret) {
  console.error("❌ UPSTOX_API_KEY and UPSTOX_API_SECRET must be set in your .env file.");
  process.exit(1);
}

// Listen specifically on the redirect URI path to capture the ?code= query parameter
app.get(REDIRECT_PATH, async (req, res) => {
  const code = req.query.code;
  
  if (!code) {
    return res.status(400).send("No code provided. Please try logging in again.");
  }

  try {
    console.log("\n🔄 Authorization code received. Exchanging for access token...");

    const body = new URLSearchParams({
      code: code,
      client_id: apiKey,
      client_secret: apiSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const response = await axios.post("https://api.upstox.com/v2/login/authorization/token", body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
    });

    const accessToken = response.data.access_token;
    console.log(`\n✅ Access Token Generated Successfully!`);
    console.log(`🔑 Token: ${accessToken.substring(0, 20)}... (truncated)\n`);

    // Automatically update the .env file
    const envPath = path.join(__dirname, ".env");
    let envContent = fs.readFileSync(envPath, "utf8");

    if (envContent.match(/^UPSTOX_ACCESS_TOKEN\s*=.*/m)) {
      envContent = envContent.replace(/^UPSTOX_ACCESS_TOKEN\s*=.*/m, `UPSTOX_ACCESS_TOKEN=${accessToken}`);
    } else {
      envContent += `\nUPSTOX_ACCESS_TOKEN=${accessToken}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log("📝 Your .env file has been automatically updated with the new token.\n");

    res.send("<h1 style='color: green;'>✅ Authentication Successful!</h1><p>The token has been saved to your .env file. You can close this window.</p>");
    
    // Shut down the temporary server
    setTimeout(() => process.exit(0), 1500);
  } catch (error) {
    console.error("❌ Error exchanging token:", error.response ? error.response.data : error.message);
    res.send("<h1 style='color: red;'>❌ Error</h1><p>Failed to generate token. Check your terminal.</p>");
    setTimeout(() => process.exit(1), 1500);
  }
});

app.listen(PORT, () => {
  const loginUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${apiKey}&redirect_uri=${redirectUri}`;
  console.log(`\n🚀 Starting temporary Upstox Auth Server on port ${PORT}...`);
  console.log("🌐 Opening your browser for Upstox Login...");
  console.log(`\n🔗 If the browser doesn't open automatically, click here:\n${loginUrl}\n`);

  // Open the browser automatically depending on the OS
  const startCommand = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${startCommand} "${loginUrl}"`);
});