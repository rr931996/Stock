const express = require("express");
const { getUpstoxClient } = require("../lib/upstox-client");
const cache = require("../lib/cache");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const router = express.Router();

const OPTIONS_CACHE_TTL = 30 * 60 * 1000; // Cache for 30 minutes

/**
 * IMPORTANT: Authentication Setup Required
 * 
 * Upstox API requires OAuth2 authentication. Setup steps:
 * 1. Create an account at https://upstox.com/developer
 * 2. Create an API Application to get API Key and API Secret
 * 3. Set environment variables:
 *    - UPSTOX_API_KEY=your_api_key
 *    - UPSTOX_API_SECRET=your_api_secret
 *    - UPSTOX_ACCESS_TOKEN=your_access_token (after authentication)
 * 
 * 4. To get access token, visit this endpoint first:
 *    GET /api/upstox/auth-url
 * 
 * 5. Then use the code returned to exchange for token:
 *    POST /api/upstox/auth-callback?code=YOUR_AUTH_CODE
 */

// GET /api/upstox/auth-url - Get OAuth login URL
router.get("/auth-url", (req, res) => {
  try {
    const client = getUpstoxClient();
    const loginUrl = client.getLoginUrl();
    
    res.json({
      message: "Visit this URL to authenticate with Upstox",
      loginUrl,
      instructions: "After login, you'll be redirected with an authorization code. Use it in /auth-callback"
    });
  } catch (err) {
    console.error("[Upstox] Auth URL generation failed:", err.message);
    res.status(500).json({ 
      error: "Failed to generate login URL",
      details: err.message,
      setup: "Please set UPSTOX_API_KEY environment variable"
    });
  }
});

// GET /api/upstox/authorize - Redirect directly to Upstox login
router.get("/authorize", (req, res) => {
  try {
    const client = getUpstoxClient();
    const loginUrl = client.getLoginUrl();
    res.redirect(loginUrl);
  } catch (err) {
    console.error("[Upstox] Authorization redirect failed:", err.message);
    res.status(500).json({ 
      error: "Authorization failed",
      details: err.message
    });
  }
});

// POST /api/upstox/auth-callback - Exchange auth code for access token
router.get("/auth-callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.send(`
      <html>
      <body style="font-family: Arial; margin: 40px;">
        <h1 style="color: red;">❌ Authentication Failed</h1>
        <p>Authorization code is missing. Please try again.</p>
        <p><a href="/api/upstox/authorize" style="color: blue;">Try again</a></p>
      </body>
      </html>
    `);
  }

  try {
    const client = getUpstoxClient();
    const tokenData = await client.exchangeAuthorizationCode(code);

    // Save token to .env file
    const envPath = path.join(__dirname, "../.env");
    let envContent = fs.readFileSync(envPath, "utf8");

    if (envContent.match(/^UPSTOX_ACCESS_TOKEN\s*=.*/m)) {
      envContent = envContent.replace(/^UPSTOX_ACCESS_TOKEN\s*=.*/m, `UPSTOX_ACCESS_TOKEN=${tokenData.accessToken}`);
    } else {
      envContent += `\nUPSTOX_ACCESS_TOKEN=${tokenData.accessToken}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    
    // Update process.env
    process.env.UPSTOX_ACCESS_TOKEN = tokenData.accessToken;
    
    console.log("[Upstox] Token saved to .env and process.env updated");

    res.send(`
      <html>
      <head>
        <title>Upstox Authorization Success</title>
        <script>
          // Send message to parent window that auth is complete
          if (window.opener) {
            window.opener.postMessage({ type: 'UPSTOX_AUTH_SUCCESS', token: true }, '*');
          }
          // Auto-close window after 2 seconds
          setTimeout(() => window.close(), 2000);
        </script>
      </head>
      <body style="font-family: Arial; margin: 40px; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: green;">✅ Authorization Successful!</h1>
          
          <p style="font-size: 16px; color: #333;">Your Upstox API has been authorized successfully!</p>
          
          <div style="background: #d4edda; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0; border-radius: 4px; color: #155724;">
            <strong>✓ Token Generated & Saved</strong>
            <p style="margin: 10px 0 0 0; font-size: 14px;">Your access token has been securely saved. This window will close automatically.</p>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 20px;">
            You can now return to your StockAdi Options page and it will load the options data automatically.
          </p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("[Upstox] Token exchange failed:", error.message);
    res.send(`
      <html>
      <head>
        <title>Authorization Failed</title>
      </head>
      <body style="font-family: Arial; margin: 40px; background: #f5f5f5;">
        <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1 style="color: red;">❌ Authorization Failed</h1>
          <p style="color: #666; margin: 20px 0;">
            <strong>Error:</strong> ${error.message}
          </p>
          <p style="color: #666; font-size: 14px;">
            Please try again or contact support if the problem persists.
          </p>
          <a href="/api/upstox/authorize" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">
            Try Again
          </a>
        </div>
      </body>
      </html>
    `);
  }
});

// POST /api/upstox/options-premiums
// Fetch option premiums for specific strikes
// Required body: { symbol, strikes, expiryDate (YYYY-MM-DD) }
router.post("/options-premiums", async (req, res) => {
  const { symbol, strikes, expiryDate } = req.body;

  if (!symbol) {
    return res.status(400).json({ error: "Symbol is required" });
  }
  if (!Array.isArray(strikes) || strikes.length === 0) {
    return res.status(400).json({ error: "Strikes array is required" });
  }
  if (!expiryDate) {
    return res.status(400).json({ error: "expiryDate is required (format: YYYY-MM-DD)" });
  }

  const cacheKey = `upstox:premiums:${symbol}:${expiryDate}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[Upstox] Cache hit for premiums: ${symbol} on ${expiryDate}`);
    return res.json(cached);
  }

  try {
    const client = getUpstoxClient();

    // Check if authenticated
    if (!client.accessToken) {
      console.warn("[Upstox] No access token available for options premiums");
      
      // Return nulls until authenticated
      const emptyPremiums = strikes.reduce((acc, item) => {
        acc[`${item.type}:${item.strike}`] = null;
        return acc;
      }, {});

      return res.json({
        source: 'Upstox',
        symbol: symbol.toUpperCase(),
        premiums: emptyPremiums,
        warning: `Upstox API not authenticated. Please visit /api/upstox/auth-url to authenticate and enable options data.`,
        authenticated: false
      });
    }

    // Fetch option data from Upstox API (real prices)
    console.log(`[Upstox] Fetching option data for ${symbol} on ${expiryDate}`);
    
    let optionsAvailable = false;
    let hasRealData = false;
    const premiums = {};
    
    // Initialize premiums with nulls for all requested strikes
    strikes.forEach(item => {
      premiums[`${item.type}:${item.strike}`] = null;
    });

    try {
      // Try the smart expiry method that auto-finds the correct date
      console.log(`[Upstox] Fetching contracts with smart expiry detection for ${expiryDate}`);
      const contractsResponse = await client.getOptionContractsSmartExpiry(
        'NSE_INDEX|Nifty 50',
        expiryDate
      );

      console.log(`[Upstox] Smart expiry resolved to: ${contractsResponse.actualExpiryDate}`);
      if (contractsResponse.wasExpiryAdjusted) {
        console.log(`[Upstox] ⚠️  Requested ${expiryDate} not available, using ${contractsResponse.actualExpiryDate}`);
      }
      
      if (contractsResponse?.status === 'success' && Array.isArray(contractsResponse.data)) {
        const contracts = contractsResponse.data;
        console.log(`[Upstox] Received ${contracts.length} contracts with prices from API`);

        if (contracts.length > 0) {
          // Build a map of strike_price + type -> premium
          const strikeDataMap = {};
          let validLtpCount = 0;
          contracts.forEach(contract => {
            const strike = contract.strike_price;
            const type = contract.instrument_type; // 'CE' or 'PE'
            
            if (contract.ltp) {
              validLtpCount++;
              const key = type === 'CE' ? 'buyCall' : 'buyPut';
              const sellKey = type === 'CE' ? 'sellCall' : 'sellPut';
              strikeDataMap[`${key}:${strike}`] = contract.ltp;
              strikeDataMap[`${sellKey}:${strike}`] = contract.ltp;
              console.log(`[Upstox] ${type} ${strike}: ₹${contract.ltp} (from real API on ${contractsResponse.actualExpiryDate})`);
            }
          });

          if (validLtpCount > 0) {
            hasRealData = true;
            optionsAvailable = true;
            // Match requested strikes with available data
            strikes.forEach(item => {
              const key = `${item.type}:${Math.round(item.strike)}`;
              if (strikeDataMap[key] !== undefined) {
                premiums[`${item.type}:${item.strike}`] = strikeDataMap[key];
              }
            });
            const filledPremiums = Object.values(premiums).filter(v => v !== null).length;
            console.log(`[Upstox] Matched ${filledPremiums}/${strikes.length} requested premiums with real API data`);
          } else {
            console.warn(`[Upstox] Contracts returned but no LTP available. Falling back to estimation.`);
          }
        } else {
          console.warn(`[Upstox] Contracts API returned 0 contracts even after date adjustment`);
        }
      } else {
        console.warn(`[Upstox] Contracts API returned error:`, contractsResponse?.error || contractsResponse?.status);
      }
    } catch (contractsErr) {
      console.error(`[Upstox] Error fetching contracts:`, contractsErr.message);
    }

    // If we don't have real data, fall back to estimation
    if (!hasRealData) {
      console.log(`[Upstox] No real data available. Using estimated premiums.`);
      
      try {
        // Get current Nifty price
        const niftyQuote = await client.getNiftyQuote();
        const spotPrice = niftyQuote.price;
        
        // Calculate days to expiry
        const today = new Date();
        const expiry = new Date(expiryDate);
        const daysToExpiry = Math.max(1, (expiry - today) / (1000 * 60 * 60 * 24));
        const timeDecay = Math.min(1.0, daysToExpiry / 7); // Weekly options baseline = 7 days
        
        // ATM premium: 0.35% of spot for weekly options (calibrated to real Nifty market)
        const atmPremium = spotPrice * 0.0035 * timeDecay;
        
        // Calculate premiums for all requested strikes
        // Realistic model based on market data for Nifty weekly options
        strikes.forEach(item => {
          const strike = Math.round(item.strike);
          const isCall = item.type.toLowerCase().includes('call');
          const moneyness = strike / spotPrice; // 1.0 = ATM
          
          let premium;
          if (isCall) {
            if (moneyness <= 1.0) {
              // ITM call: intrinsic value + time value
              premium = (spotPrice - strike) + atmPremium * 0.5;
            } else {
              // OTM call: time value with exponential decay
              const otnessPercent = (moneyness - 1.0) * 100; // percentage OTM
              // Gentler decay to match real market: exp(-OTM% / 3)
              premium = atmPremium * Math.exp(-otnessPercent / 3);
            }
          } else {
            if (moneyness >= 1.0) {
              // ITM put: intrinsic value + time value
              premium = (strike - spotPrice) + atmPremium * 0.5;
            } else {
              // OTM put: time value with exponential decay
              const otnessPercent = (1.0 - moneyness) * 100; // percentage OTM
              premium = atmPremium * Math.exp(-otnessPercent / 3);
            }
          }
          
          // Ensure minimum premium of 0.05 (smallest tradeable unit)
          premiums[`${item.type}:${item.strike}`] = Math.round(Math.max(0.05, premium) * 100) / 100;
          console.log(`[Upstox] Estimated ${item.type} ${strike}: ₹${premiums[`${item.type}:${item.strike}`]}`);
        });

        optionsAvailable = true;
      } catch (estErr) {
        console.error(`[Upstox] Error calculating estimated premiums:`, estErr.message);
      }
    }

    const responsePayload = {
      source: 'Upstox',
      symbol: symbol.toUpperCase(),
      expiryDate,
      premiums,
      fetchedAt: new Date().toISOString(),
      authenticated: true,
      optionsAvailable: optionsAvailable,
      message: optionsAvailable 
        ? hasRealData
          ? 'Real-time premiums loaded from Upstox API'
          : 'Estimated premiums calculated (no real-time data available)'
        : 'Option premiums currently unavailable from Upstox API.',
      isEstimated: !hasRealData && optionsAvailable
    };

    cache.set(cacheKey, responsePayload, OPTIONS_CACHE_TTL);

    res.json(responsePayload);
  } catch (err) {
    console.error(`[Upstox] Error fetching option premiums for ${symbol}:`, err.message);
    
    // Return nulls for all strikes when fetch fails
    const emptyPremiums = strikes.reduce((acc, item) => {
      acc[`${item.type}:${item.strike}`] = null;
      return acc;
    }, {});

    res.status(500).json({
      error: "Failed to fetch option premiums",
      details: err.message,
      source: 'Upstox',
      symbol: symbol.toUpperCase(),
      expiryDate,
      premiums: emptyPremiums,
      warning: `Failed to fetch option chain data from Upstox: ${err.message}. Verify API token is valid and expiry date is correct.`,
      authenticated: false
    });
  }
});

// GET /api/upstox/test-contracts - Debug endpoint to test option contracts endpoint
router.get("/test-contracts", async (req, res) => {
  try {
    const client = getUpstoxClient();
    
    if (!client.accessToken) {
      return res.status(401).json({
        error: "Not authenticated",
        message: "Please authenticate first"
      });
    }

    console.log("[Upstox Test] Testing /option/contract endpoint...");

    const testResults = [];

    // Test 1: Try with NSE_INDEX|Nifty 50
    try {
      const response = await client.getOptionContractsWithPrices({
        instrumentKey: 'NSE_INDEX|Nifty 50',
        expiryDate: '2026-04-22'
      });
      testResults.push({
        test: "NSE_INDEX|Nifty 50 with 2026-04-22",
        status: response.status,
        contractCount: response.data?.length || 0,
        firstContract: response.data?.[0] || null,
        sampleContracts: response.data?.slice(0, 3) || []
      });
    } catch (err) {
      testResults.push({
        test: "NSE_INDEX|Nifty 50",
        error: err.message
      });
    }

    // Test 2: Try to list all available contract expirations (if endpoint exists)
    try {
      const response = await axios.get(`https://api.upstox.com/v2/option/contract`, {
        params: {
          instrument_key: 'NSE_INDEX|Nifty 50'
        },
        headers: {
          'Authorization': `Bearer ${client.accessToken}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      testResults.push({
        test: "Raw API call without expiry",
        status: response.data?.status,
        contractCount: response.data?.data?.length || 0,
        expiryDates: [...new Set(response.data?.data?.map(c => c.expiry))] || []
      });
    } catch (err) {
      testResults.push({
        test: "Raw API call without expiry",
        error: err.response?.data || err.message
      });
    }

    res.json({
      message: "Option contracts API diagnostics",
      token: `${client.accessToken.substring(0, 30)}...`,
      tests: testResults
    });
  } catch (err) {
    console.error("[Upstox Test] Error:", err.message);
    res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
});

// GET /api/upstox/nifty - Get Nifty 50 current price from Upstox (no fallback)
router.get("/nifty", async (req, res) => {
  const cacheKey = `upstox:nifty`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log("[Upstox] Cache hit for Nifty quote");
    return res.json(cached);
  }

  try {
    const client = getUpstoxClient();
    
    if (!client.accessToken) {
      console.warn("[Upstox] No access token available for Nifty quote");
      return res.status(401).json({
        error: "Unauthorized",
        message: "Upstox API is not authenticated",
        setup: "Please authenticate first using GET /api/upstox/auth-url",
        authenticated: false,
        price: null
      });
    }

    console.log("[Upstox] Fetching Nifty quote with token:", client.accessToken.substring(0, 20) + '...');
    const niftyData = await client.getNiftyQuote();
    cache.set(cacheKey, niftyData, 5 * 60 * 1000); // Cache for 5 minutes
    console.log("[Upstox] Nifty 50 price fetched successfully");
    
    res.json(niftyData);
  } catch (err) {
    console.error("[Upstox] Error fetching Nifty price:", err.message);
    console.error("[Upstox] Full error:", err);
    
    // Determine appropriate status code
    const statusCode = err.response?.status === 401 ? 401 : 503;
    
    res.status(statusCode).json({ 
      error: "Failed to fetch Nifty 50 price from Upstox",
      details: err.message,
      authenticated: false,
      message: statusCode === 401 
        ? "Authentication failed - please re-authenticate"
        : "Service temporarily unavailable",
      setup: "Verify Upstox API Key and that authentication is complete at /api/upstox/auth-url"
    });
  }
});

// GET /api/upstox/option-expirations - Get available option expiration dates
router.get("/option-expirations", async (req, res) => {
  const cacheKey = `upstox:expirations`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log("[Upstox] Cache hit for option expirations");
    return res.json(cached);
  }

  try {
    const client = getUpstoxClient();
    
    // Check authentication first
    if (!client.accessToken) {
      console.warn("[Upstox] No access token for option expirations");
      return res.status(401).json({
        error: "Unauthorized",
        message: "Upstox API is not authenticated",
        authenticated: false,
        data: []
      });
    }
    
    const expirations = await client.getOptionExpirations();

    cache.set(cacheKey, expirations, 60 * 60 * 1000); // Cache for 1 hour
    console.log("[Upstox] Option expirations fetched");
    
    res.json(expirations);
  } catch (err) {
    console.error("[Upstox] Error fetching option expirations:", err.message);
    
    // Check if it's an auth error from the API
    const statusCode = err.message.includes('401') || err.message.includes('unauthorized') ? 401 : 503;
    
    res.status(statusCode).json({ 
      error: "Failed to fetch option expirations",
      details: err.message,
      authenticated: false,
      message: statusCode === 401 ? "Authentication failed - please re-authenticate" : "Service temporarily unavailable",
      data: []
    });
  }
});

// GET /api/upstox/test-option - Test endpoint to debug option premiums
router.get("/test-option", async (req, res) => {
  try {
    const client = getUpstoxClient();
    
    if (!client.accessToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Try different possible instrument key formats
    const testFormats = [
      // Format 1: Current format with 2-digit year
      'NSE_FO|NIFTY22APR2624200CE',
      
      // Format 2: With colon instead of pipe
      'NSE_FO:NIFTY22APR2624200CE',
      
      // Format 3: Full year (2026)
      'NSE_FO|NIFTY22APR2624200CE',
      
      // Format 4: Different date format (DDMMMYY with 4-digit year)
      'NSE_FO|NIFTY220426024200CE',
      
      // Format 5: Underscore instead of pipe
      'NSE_FO_NIFTY22APR2624200CE',
      
      // Format 6: Without date prefix, just strike
      'NSE_FO|NIFTY24200CE',
      
      // Format 7: Year at beginning
      'NSE_FO|NIFTY2622APR24200CE',
    ];

    console.log("[Upstox] Testing multiple option key formats...");
    
    const results = [];
    
    for (const format of testFormats) {
      try {
        const response = await client.getOptionPremiums([format]);
        const hasData = response.data && Object.keys(response.data).length > 0;
        results.push({
          format,
          success: response.status === 'success',
          hasData,
          dataCount: Object.keys(response.data || {}).length,
          sampleKey: Object.keys(response.data || {})[0]
        });
        console.log(`[Upstox] Format ${format}: ${hasData ? 'HAS DATA' : 'empty'}`);
      } catch (err) {
        results.push({
          format,
          error: err.message
        });
      }
    }
    
    res.json({
      results,
      message: results.filter(r => r.hasData).length > 0 
        ? `Found working format(s)` 
        : 'No formats returned data - may need to try option/chain endpoint'
    });
  } catch (err) {
    console.error("[Upstox] Test failed:", err.message);
    res.status(500).json({
      error: err.message,
      details: err.response?.data
    });
  }
});

// GET /api/upstox/test-option-chain - Fetch actual option chain to see real instrument keys
router.get("/test-option-chain", async (req, res) => {
  try {
    const client = getUpstoxClient();
    
    if (!client.accessToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    console.log("[Upstox] Fetching actual option chain for Nifty...");
    
    // Try to fetch option chain with different expiry formats
    const today = new Date();
    const nextWednesday = new Date(today);
    nextWednesday.setDate(today.getDate() + (3 - today.getDay() + 7) % 7 || 7);
    
    const day = String(nextWednesday.getDate()).padStart(2, '0');
    const month = nextWednesday.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const year2digit = String(nextWednesday.getFullYear()).slice(-2);
    const year4digit = String(nextWednesday.getFullYear());
    const dateYYYYMMDD = nextWednesday.toISOString().split('T')[0];
    
    const expiryFormats = [
      { label: 'DDMMMYY', value: `${day}${month}${year2digit}` },
      { label: 'YYYY-MM-DD', value: dateYYYYMMDD },
      { label: 'DDMMMYYYY', value: `${day}${month}${year4digit}` },
    ];

    const chainResults = [];
    
    for (const format of expiryFormats) {
      try {
        console.log(`[Upstox] Trying option chain with expiry format: ${format.label} = ${format.value}`);
        const response = await client.axiosInstance.get('/option/chain', {
          params: {
            instrument_key: 'NSE_INDEX|Nifty 50',
            expiry_date: format.value
          },
          headers: {
            'Authorization': `Bearer ${client.accessToken}`,
            'Accept': 'application/json'
          }
        });

        console.log(`[Upstox] Option chain response for ${format.label}:`, JSON.stringify(response.data).substring(0, 500));
        
        let sampleInstrumentKeys = [];
        if (response.data?.data && Array.isArray(response.data.data)) {
          // Extract sample instrument keys from the response
          const samples = response.data.data.slice(0, 2);
          sampleInstrumentKeys = samples.map(item => ({
            strike: item.strike_price,
            callKey: item.call_options?.instrument_key,
            putKey: item.put_options?.instrument_key
          }));
        }
        
        chainResults.push({
          format: format.label,
          expiryValue: format.value,
          success: response.data?.status === 'success',
          totalStrikes: Array.isArray(response.data?.data) ? response.data.data.length : 0,
          sampleKeys: sampleInstrumentKeys
        });
      } catch (err) {
        chainResults.push({
          format: format.label,
          expiryValue: format.value,
          error: err.response?.status || err.message,
          details: err.response?.data
        });
      }
    }
    
    res.json({
      chainResults,
      message: 'Use the working format and instrument keys from above'
    });
  } catch (err) {
    console.error("[Upstox] Chain test failed:", err.message);
    res.status(500).json({
      error: err.message
    });
  }
});

// GET /api/upstox/refresh-token - Reload token from .env file
router.get("/refresh-token", (req, res) => {
  try {
    // Read and reload .env file
    const envPath = path.join(__dirname, "../.env");
    
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, "utf8");
      const envConfig = dotenv.parse(envContent);
      
      // Update process.env with the latest values from .env
      Object.assign(process.env, envConfig);
      
      console.log("[Upstox] Environment variables refreshed from .env file");
    }
    
    // Now check the status with the refreshed environment
    const client = getUpstoxClient();
    const hasToken = !!client.accessToken;
    const hasCredentials = !!(client.apiKey && client.apiSecret);

    res.json({
      authenticated: hasToken,
      hasCredentials,
      message: hasToken 
        ? "Upstox API is authenticated and ready to use"
        : "Upstox API requires authentication. Use /api/upstox/auth-url to get started"
    });
  } catch (err) {
    console.error("[Upstox] Error refreshing token:", err.message);
    res.status(500).json({ 
      error: "Failed to refresh token",
      details: err.message
    });
  }
});

// GET /api/upstox/status - Check Upstox API authentication status
router.get("/status", (req, res) => {
  try {
    const client = getUpstoxClient();
    const hasToken = !!client.accessToken;
    const hasCredentials = !!(client.apiKey && client.apiSecret);

    res.json({
      authenticated: hasToken,
      hasCredentials,
      message: hasToken 
        ? "Upstox API is authenticated and ready to use"
        : "Upstox API requires authentication. Use /api/upstox/auth-url to get started"
    });
  } catch (err) {
    res.status(500).json({ 
      error: "Failed to check status",
      details: err.message
    });
  }
});

// GET /api/upstox/historical
router.get("/historical", async (req, res) => {
  const symbol = req.query.symbol || 'NSE_INDEX|Nifty 50';
  
  const cacheKey = `upstox:historical:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ data: cached });
  }

  try {
    const client = getUpstoxClient();
    
    const today = new Date();
    const toDate = today.toISOString().split('T')[0];
    const fromDateObj = new Date();
    fromDateObj.setDate(fromDateObj.getDate() - 30);
    const fromDate = fromDateObj.toISOString().split('T')[0];

    const data = await client.getHistoricalData(symbol, 'day', toDate, fromDate);
    
    cache.set(cacheKey, data, 60 * 60 * 1000); // 1 hour cache
    res.json({ data });
  } catch (err) {
    console.error("[Upstox] Error fetching historical data:", err.message);
    res.status(500).json({ error: "Failed to fetch historical data", details: err.message });
  }
});

// GET /api/upstox/option-chain - Fetch complete option chain with Greeks and market data
// Query params: 
//   - expiryDate (optional): YYYY-MM-DD format, defaults to next Wednesday
//   - symbol (optional): defaults to NSE_INDEX|Nifty 50
router.get("/option-chain", async (req, res) => {
  const symbol = req.query.symbol || 'NSE_INDEX|Nifty 50';
  let expiryDate = req.query.expiryDate;

  // If no expiry date provided, use next Wednesday (Nifty options expiry)
  if (!expiryDate) {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysUntilWednesday = (3 - dayOfWeek + 7) % 7 || 7;
    const nextWednesday = new Date(today);
    nextWednesday.setDate(today.getDate() + daysUntilWednesday);
    expiryDate = nextWednesday.toISOString().split('T')[0];
  }

  const cacheKey = `upstox:option-chain:${symbol}:${expiryDate}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[Upstox] Cache hit for option chain: ${symbol} on ${expiryDate}`);
    return res.json(cached);
  }

  try {
    const client = getUpstoxClient();

    if (!client.accessToken) {
      console.warn("[Upstox] No access token available for option chain");
      return res.status(401).json({
        error: "Unauthorized",
        message: "Upstox API is not authenticated",
        setup: "Please authenticate first using GET /api/upstox/auth-url",
        authenticated: false
      });
    }

    console.log(`[Upstox] Fetching option chain for ${symbol} on ${expiryDate}`);

    // Call Upstox option/chain endpoint
    const response = await client.axiosInstance.get('/option/chain', {
      params: {
        instrument_key: symbol,
        expiry_date: expiryDate
      },
      headers: {
        'Authorization': `Bearer ${client.accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (response.data?.status === 'success' && Array.isArray(response.data.data)) {
      const chainData = response.data.data;
      
      console.log(`[Upstox] Received option chain with ${chainData.length} strike prices`);

      // Format response with additional calculations
      const formattedData = {
        status: 'success',
        symbol,
        expiryDate,
        underlying_spot_price: chainData[0]?.underlying_spot_price || null,
        underlying_key: chainData[0]?.underlying_key || symbol,
        chains: chainData.map(item => ({
          strike_price: item.strike_price,
          expiry: item.expiry,
          pcr: item.pcr || null,
          underlying_spot_price: item.underlying_spot_price,
          call_options: item.call_options ? {
            instrument_key: item.call_options.instrument_key,
            ltp: item.call_options.market_data?.ltp || null,
            volume: item.call_options.market_data?.volume || 0,
            oi: item.call_options.market_data?.oi || 0,
            bid_price: item.call_options.market_data?.bid_price || null,
            bid_qty: item.call_options.market_data?.bid_qty || 0,
            ask_price: item.call_options.market_data?.ask_price || null,
            ask_qty: item.call_options.market_data?.ask_qty || 0,
            close_price: item.call_options.market_data?.close_price || null,
            prev_oi: item.call_options.market_data?.prev_oi || 0,
            greeks: {
              delta: item.call_options.option_greeks?.delta || null,
              theta: item.call_options.option_greeks?.theta || null,
              gamma: item.call_options.option_greeks?.gamma || null,
              vega: item.call_options.option_greeks?.vega || null,
              iv: item.call_options.option_greeks?.iv || null,
              pop: item.call_options.option_greeks?.pop || null
            }
          } : null,
          put_options: item.put_options ? {
            instrument_key: item.put_options.instrument_key,
            ltp: item.put_options.market_data?.ltp || null,
            volume: item.put_options.market_data?.volume || 0,
            oi: item.put_options.market_data?.oi || 0,
            bid_price: item.put_options.market_data?.bid_price || null,
            bid_qty: item.put_options.market_data?.bid_qty || 0,
            ask_price: item.put_options.market_data?.ask_price || null,
            ask_qty: item.put_options.market_data?.ask_qty || 0,
            close_price: item.put_options.market_data?.close_price || null,
            prev_oi: item.put_options.market_data?.prev_oi || 0,
            greeks: {
              delta: item.put_options.option_greeks?.delta || null,
              theta: item.put_options.option_greeks?.theta || null,
              gamma: item.put_options.option_greeks?.gamma || null,
              vega: item.put_options.option_greeks?.vega || null,
              iv: item.put_options.option_greeks?.iv || null,
              pop: item.put_options.option_greeks?.pop || null
            }
          } : null
        })),
        fetchedAt: new Date().toISOString(),
        authenticated: true
      };

      cache.set(cacheKey, formattedData, 5 * 60 * 1000); // Cache for 5 minutes
      console.log(`[Upstox] Option chain formatted and cached`);

      res.json(formattedData);
    } else {
      console.error(`[Upstox] Option chain API returned error:`, response.data?.status);
      res.status(503).json({
        error: "Failed to fetch option chain",
        details: response.data?.error || 'No data returned from Upstox API',
        status: response.data?.status,
        authenticated: true
      });
    }
  } catch (err) {
    console.error(`[Upstox] Error fetching option chain:`, err.message);
    
    // Determine appropriate status code
    let statusCode = 503; // Default to service unavailable
    let message = "Service temporarily unavailable";
    
    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      statusCode = 401;
      message = "Authentication failed - please re-authenticate";
    } else if (err.response?.status === 401) {
      statusCode = 401;
      message = "Authentication failed - please re-authenticate";
    }
    
    res.status(statusCode).json({
      error: "Failed to fetch option chain from Upstox",
      details: err.message,
      authenticated: statusCode !== 401,
      message,
      expiryDate,
      symbol
    });
  }
});

module.exports = router;
