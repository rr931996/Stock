const cache = new Map();

/**
 * Retrieves a value from the cache. Returns undefined if the key is not found or has expired.
 * @param {string} key The cache key.
 * @returns {any | undefined} The cached value or undefined.
 */
function get(key) {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }

  // Check if the entry has expired
  if (entry.expiry < Date.now()) {
    cache.delete(key); // Clean up expired entry
    return undefined;
  }

  return entry.value;
}

/**
 * Stores a value in the cache with a TTL (Time-to-Live).
 * @param {string} key The cache key.
 * @param {any} value The value to store.
 * @param {number} ttlMilliseconds The Time-to-Live in milliseconds.
 */
function set(key, value, ttlMilliseconds) {
  const expiry = Date.now() + ttlMilliseconds;
  cache.set(key, { value, expiry });
}

module.exports = { get, set };