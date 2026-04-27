/**
 * Upstox API Client for Options Data
 * 
 * Upstox Authentication & Options API
 * Reference: https://upstox.com/developer/api-documentation/authentication
 */

const axios = require('axios');

// Upstox API Configuration
const UPSTOX_BASE_URL = 'https://api.upstox.com/v2';
const UPSTOX_AUTH_URL = 'https://api.upstox.com/login';

/**
 * ===== IMPORTANT: SETUP REQUIRED =====
 * Before using this client, you must:
 * 1. Register at https://upstox.com/developer
 * 2. Create an API application
 * 3. Get your API Key and API Secret
 * 4. Store credentials in environment variables:
 *    - UPSTOX_API_KEY
 *    - UPSTOX_API_SECRET
 *    - UPSTOX_REDIRECT_URI (optional, defaults to http://localhost:3000)
 * 
 * Authentication Flow:
 * 1. User visits: https://api.upstox.com/login?apiKey=YOUR_API_KEY&redirect_uri=YOUR_REDIRECT_URI
 * 2. User grants permission
 * 3. Redirected back with authorization code
 * 4. Exchange code for access token using exchangeAuthorizationCode()
 * 5. Use access token for API calls
 */

class UpstoxClient {
  constructor(accessToken = null) {
    this.accessToken = accessToken || process.env.UPSTOX_ACCESS_TOKEN;
    this.apiKey = process.env.UPSTOX_API_KEY;
    this.apiSecret = process.env.UPSTOX_API_SECRET;
    this.redirectUri = process.env.UPSTOX_REDIRECT_URI || 'http://localhost:3000';

    this.axiosInstance = axios.create({
      baseURL: UPSTOX_BASE_URL,
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }
    });
  }

  /**
   * Get the login URL for user authentication
   * User should visit this URL to grant permission
   */
  getLoginUrl() {
    if (!this.apiKey) {
      throw new Error('UPSTOX_API_KEY environment variable not set');
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.apiKey,
      redirect_uri: this.redirectUri
    });
    return `https://api.upstox.com/v2/login/authorization/dialog?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * Call this after user grants permission (you get the code from redirect)
   */
  async exchangeAuthorizationCode(authCode) {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('UPSTOX_API_KEY or UPSTOX_API_SECRET not set');
    }

    try {
      const body = new URLSearchParams({
        code: authCode,
        client_id: this.apiKey,
        client_secret: this.apiSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code'
      });

      const response = await axios.post(`${UPSTOX_BASE_URL}/login/authorization/token`, body.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      });

      this.accessToken = response.data.access_token;
      process.env.UPSTOX_ACCESS_TOKEN = this.accessToken;
      console.log('[Upstox] Access token obtained successfully');

      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type
      };
    } catch (err) {
      console.error('[Upstox] Token exchange failed:', err.response?.data || err.message);
      throw new Error(`Failed to exchange authorization code: ${err.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    if (!this.apiSecret) {
      throw new Error('UPSTOX_API_SECRET not set');
    }

    try {
      const response = await axios.post(`${UPSTOX_BASE_URL}/login/authorization/refresh`, {
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      this.accessToken = response.data.access_token;
      console.log('[Upstox] Access token refreshed successfully');

      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in
      };
    } catch (err) {
      console.error('[Upstox] Token refresh failed:', err.response?.data || err.message);
      throw new Error(`Failed to refresh access token: ${err.message}`);
    }
  }

  /**
   * Get available option contracts for a given expiry
   * Uses /option/contract endpoint to get all contracts, then fetches prices
   */
  async getOptionContractsWithPrices(options = {}) {
    if (!this.accessToken) {
      throw new Error('Access token not set. Please authenticate first.');
    }

    const instrumentKey = options.instrumentKey || 'NSE_INDEX|Nifty 50';
    const expiryDate = options.expiryDate; // Format: YYYY-MM-DD

    if (!expiryDate) {
      throw new Error('expiryDate is required in format YYYY-MM-DD');
    }

    try {
      console.log(`[Upstox] Fetching option contracts for ${instrumentKey} on ${expiryDate}`);

      // Fetch available option contracts for this expiry
      const contractResponse = await this.axiosInstance.get('/option/contract', {
        params: {
          instrument_key: instrumentKey,
          expiry_date: expiryDate
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (contractResponse.data?.status !== 'success' || !Array.isArray(contractResponse.data?.data)) {
        console.warn('[Upstox] No contracts returned from API');
        return { status: 'success', data: [] };
      }

      const contracts = contractResponse.data.data;
      console.log(`[Upstox] Found ${contracts.length} option contracts for ${expiryDate}`);

      if (contracts.length === 0) {
        return { status: 'success', data: [] };
      }

      // Extract instrument keys for all contracts
      const instrumentKeys = contracts.map(c => c.instrument_key);
      console.log(`[Upstox] Fetching prices for ${instrumentKeys.length} instruments...`);

      // Fetch live prices for all contracts in chunks to avoid URL length limits
      const CHUNK_SIZE = 100;
      let allPrices = {};
      for (let i = 0; i < instrumentKeys.length; i += CHUNK_SIZE) {
        const chunk = instrumentKeys.slice(i, i + CHUNK_SIZE);
        try {
          const priceResponse = await this.axiosInstance.get('/market-quote/ltp', {
            params: { instrument_key: chunk.join(',') },
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'Accept': 'application/json'
            }
          });
          if (priceResponse.data?.status === 'success' && priceResponse.data?.data) {
            Object.assign(allPrices, priceResponse.data.data);
          }
        } catch (chunkErr) {
          console.warn(`[Upstox] Failed to fetch price chunk:`, chunkErr.message);
        }
      }

      // Build result with contracts and their prices
      const results = contracts.map(contract => {
        const priceData = allPrices[contract.instrument_key];
        return {
          instrument_key: contract.instrument_key,
          strike_price: contract.strike_price,
          instrument_type: contract.instrument_type,
          trading_symbol: contract.trading_symbol,
          ltp: priceData?.last_price || null,
          bid_price: priceData?.bid_price || null,
          ask_price: priceData?.ask_price || null
        };
      });

      console.log(`[Upstox] Successfully fetched prices for ${results.length} contracts`);
      return { status: 'success', data: results };
    } catch (err) {
      console.error('[Upstox] Option contracts fetch failed:', err.response?.data || err.message);
      return { status: 'success', data: [] };
    }
  }

  /**
   * Get available expiry dates for options and contracts for the nearest available date
   * @param {string} instrumentKey - e.g., 'NSE_INDEX|Nifty 50'
   * @param {string} requestedExpiryDate - User requested date (YYYY-MM-DD)
   * @returns {object} { status, data: [], actualExpiryDate, availableExpiryDates }
   */
  async getOptionContractsSmartExpiry(instrumentKey = 'NSE_INDEX|Nifty 50', requestedExpiryDate) {
    if (!this.accessToken) {
      throw new Error('Access token not set. Please authenticate first.');
    }

    try {
      console.log(`[Upstox] Getting available expirations for ${instrumentKey}`);

      // Get all contracts without expiry filter to see available expirations
      const allContractsResponse = await this.axiosInstance.get('/option/contract', {
        params: {
          instrument_key: instrumentKey
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (allContractsResponse.data?.status !== 'success' || !Array.isArray(allContractsResponse.data?.data)) {
        throw new Error('Failed to fetch available expirations');
      }

      // Extract unique expiry dates and sort them
      const expirySet = new Set();
      allContractsResponse.data.data.forEach(contract => {
        if (contract.expiry) {
          expirySet.add(contract.expiry);
        }
      });

      const availableExpiryDates = Array.from(expirySet).sort();
      console.log(`[Upstox] Available expirations: ${availableExpiryDates.slice(0, 5).join(', ')}`);

      // Find the best expiry date to use
      let actualExpiryDate = requestedExpiryDate;

      if (requestedExpiryDate && availableExpiryDates.includes(requestedExpiryDate)) {
        // Requested date is available, use it
        console.log(`[Upstox] Requested expiry ${requestedExpiryDate} is available`);
      } else if (requestedExpiryDate) {
        // Find nearest date after requested date
        const nearest = availableExpiryDates.find(d => d >= requestedExpiryDate);
        if (nearest) {
          console.log(`[Upstox] Requested expiry ${requestedExpiryDate} not available, using ${nearest}`);
          actualExpiryDate = nearest;
        } else {
          // Use latest available
          actualExpiryDate = availableExpiryDates[availableExpiryDates.length - 1];
          console.log(`[Upstox] Requested expiry ${requestedExpiryDate} not available, using latest ${actualExpiryDate}`);
        }
      } else {
        // No requested date, use earliest (usually nearest weekly/monthly)
        actualExpiryDate = availableExpiryDates[0];
        console.log(`[Upstox] Using earliest available expiry: ${actualExpiryDate}`);
      }

      // Now fetch contracts for the actual expiry date
      return await this.getOptionContractsWithPrices({
        instrumentKey,
        expiryDate: actualExpiryDate
      }).then(result => ({
        ...result,
        actualExpiryDate,
        availableExpiryDates,
        wasExpiryAdjusted: actualExpiryDate !== requestedExpiryDate
      }));
    } catch (err) {
      console.error('[Upstox] Smart expiry fetch failed:', err.message);
      return {
        status: 'error',
        data: [],
        error: err.message,
        availableExpiryDates: []
      };
    }
  }

  /**
   * Get option chain data for NIFTY 50
   * 
   * @param {Object} options - Query options
   * @param {string} options.instrumentKey - Instrument key (e.g., 'NSE_INDEX|Nifty 50')
   * @param {string} options.expiryDate - Expiration date (YYYY-MM-DD) - REQUIRED
   */
  async getOptionChain(options = {}) {
    if (!this.accessToken) {
      throw new Error('Access token not set. Please authenticate first.');
    }

    const instrumentKey = options.instrumentKey || 'NSE_INDEX|Nifty 50';
    const expiryDate = options.expiryDate; // Format: YYYY-MM-DD

    if (!expiryDate) {
      throw new Error('expiryDate is required in format YYYY-MM-DD');
    }

    try {
      // API expects YYYY-MM-DD format directly
      console.log(`[Upstox] Option chain request for ${instrumentKey} on ${expiryDate}`);

      // Call the option chain endpoint
      const response = await this.axiosInstance.get('/option/chain', {
        params: {
          instrument_key: instrumentKey,
          expiry_date: expiryDate
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      console.log(`[Upstox] Option chain fetched for ${instrumentKey} on ${expiryDate}`);
      return response.data;
    } catch (err) {
      console.error('[Upstox] Option chain fetch failed:', err.response?.data || err.message);

      // If option chain endpoint fails, return empty data structure
      console.log('[Upstox] Falling back to empty option chain');
      return { status: 'success', data: [] };
    }
  }

  /**
   * Get option premiums for specific strike prices
   * 
   * @param {string[]} instrumentKeys - Array of instrument keys (e.g., ['NSE_FO|NIFTY24OCT24500CE'])
   */
  async getOptionPremiums(instrumentKeys) {
    if (!this.accessToken) {
      throw new Error('Access token not set. Please authenticate first.');
    }

    if (!Array.isArray(instrumentKeys) || instrumentKeys.length === 0) {
      throw new Error('An array of instrumentKeys is required.');
    }

    try {
      const response = await this.axiosInstance.get('/market-quote/ltp', {
        params: {
          instrument_key: instrumentKeys.join(',')
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });

      console.log(`[Upstox] Option premiums fetched for ${instrumentKeys.length} strikes`);
      return response.data;
    } catch (err) {
      console.error('[Upstox] Option premiums fetch failed:', err.response?.data || err.message);
      throw new Error(`Failed to fetch option premiums: ${err.message}`);
    }
  }

  /**
   * Get quote for Nifty 50 using Upstox market data
   */
  async getNiftyQuote() {
    if (!this.accessToken) {
      throw new Error('Access token not set. Please authenticate first.');
    }

    try {
      console.log('[Upstox] Fetching Nifty 50 quote...');
      const response = await this.axiosInstance.get('/market-quote/quotes', {
        params: {
          instrument_key: 'NSE_INDEX|Nifty 50'
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      console.log('[Upstox] Response received:', JSON.stringify(response.data).substring(0, 200));

      // Parse the response - Upstox returns data under a dynamic key like 'NSE_INDEX:Nifty 50'
      if (response.data?.status !== 'success') {
        throw new Error('Upstox API returned non-success status');
      }

      // Get the first (and usually only) key from the data object
      const quoteData = Object.values(response.data?.data || {})[0];

      if (!quoteData || !quoteData.last_price) {
        console.error('[Upstox] Invalid response format:', response.data);
        throw new Error('No quote data received from Upstox API');
      }

      console.log('[Upstox] Nifty 50 quote fetched successfully. Price:', quoteData.last_price);

      // Extract OHLC data
      const ohlc = quoteData.ohlc || {};

      return {
        symbol: 'NIFTY 50',
        price: quoteData.last_price,
        change: quoteData.net_change || 0,
        changePercent: ((quoteData.net_change || 0) / (quoteData.last_price - (quoteData.net_change || 0)) * 100) || 0,
        currency: 'INR',
        lastUpdated: quoteData.timestamp || new Date().toISOString(),
        high: ohlc.high,
        low: ohlc.low,
        open: ohlc.open,
        close: ohlc.close,
        volume: quoteData.volume
      };
    } catch (err) {
      console.error('[Upstox] Nifty quote fetch failed:');
      console.error('  Status:', err.response?.status);
      console.error('  Data:', err.response?.data);
      console.error('  Message:', err.message);
      throw new Error(`Failed to fetch Nifty 50 quote: ${err.message}`);
    }
  }

  /**
   * Get all available option expiration dates for Nifty 50
   */
  async getOptionExpirations() {
    if (!this.accessToken) {
      throw new Error('Access token not set. Please authenticate first.');
    }

    try {
      const response = await this.axiosInstance.get('/market-quote/options/expirations', {
        params: {
          instrument_key: 'NSE_INDEX|Nifty50'
        },
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      console.log('[Upstox] Option expirations fetched');
      return response.data;
    } catch (err) {
      console.error('[Upstox] Option expirations fetch failed:', err.response?.data || err.message);
      throw new Error(`Failed to fetch option expirations: ${err.message}`);
    }
  }

  /**
   * Get historical data for an instrument
   */
  async getHistoricalData(instrumentKey = 'NSE_INDEX|Nifty 50', interval = 'day', toDate, fromDate) {
    if (!this.accessToken) {
      throw new Error('Access token not set. Please authenticate first.');
    }
    try {
      console.log(`[Upstox] Fetching historical data for ${instrumentKey} from ${fromDate} to ${toDate}`);
      const response = await this.axiosInstance.get(`/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${toDate}/${fromDate}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Accept': 'application/json'
        }
      });

      if (response.data?.status !== 'success') {
        throw new Error('Failed to fetch historical data');
      }

      const candles = response.data.data?.candles || [];
      return candles.map(candle => ({
        symbol: instrumentKey,
        date: new Date(candle[0]).toISOString(),
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));
    } catch (err) {
      console.error('[Upstox] Historical data fetch failed:', err.response?.data || err.message);
      throw new Error(`Failed to fetch historical data: ${err.message}`);
    }
  }
}

// Create singleton instance
let upstoxInstance = null;

function getUpstoxClient(accessToken = null) {
  // Always create a new instance if a token is provided explicitly
  if (accessToken) {
    return new UpstoxClient(accessToken);
  }

  // Create a new instance if we don't have one, or if the token in process.env has changed
  const currentToken = process.env.UPSTOX_ACCESS_TOKEN;

  if (!upstoxInstance || upstoxInstance.accessToken !== currentToken) {
    upstoxInstance = new UpstoxClient(accessToken);
  }

  return upstoxInstance;
}

module.exports = {
  UpstoxClient,
  getUpstoxClient
};
