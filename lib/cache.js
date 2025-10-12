const { LRUCache } = require("lru-cache");

// Allow TTL to be configured via environment variables, with sensible defaults.
const DEFAULT_TTL_MS = parseInt(process.env.CACHE_TTL_MS, 10) || 5 * 60 * 1000;

// Configure the LRU cache
const options = {
  max: 1000, // Maximum number of items in the cache
  ttl: DEFAULT_TTL_MS, // Default TTL for all entries
};

const cache = new LRUCache(options);

/**
 * Retrieves a value from the cache. Returns undefined if the key is not found or has expired.
 * @param {string} key The cache key.
 * @returns {any | undefined} The cached value or undefined.
 */
function get(key) {
  return cache.get(key);
}

/**
 * Stores a value in the cache with a TTL (Time-to-Live).
 * @param {string} key The cache key.
 * @param {any} value The value to store.
 * @param {number} ttlMilliseconds The Time-to-Live in milliseconds.
 */
function set(key, value, ttlMilliseconds) {
  // The TTL is now managed by the LRUCache instance itself, but you can override it per-entry if needed.
  // For simplicity, we'll rely on the default TTL set in the options.
  cache.set(key, value, { ttl: ttlMilliseconds });
}

module.exports = { get, set };
