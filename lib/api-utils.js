const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

/**
 * A higher-order function that wraps an async function with a retry mechanism
 * that includes exponential backoff for 429 "Too Many Requests" errors.
 *
 * @param {Function} fn The async function to execute.
 * @returns {Function} A new function that will retry on 429 errors.
 */
function withRetry(fn) {
  return async function(...args) {
    let lastError;
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        return await fn(...args);
      } catch (err) {
        // Check if the error is a 429 "Too Many Requests" error.
        // yahoo-finance2 nests the original fetch error in the `cause` property.
        if (err.cause && err.cause.response && err.cause.response.status === 429) {
          lastError = err;
          const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, i);
          console.warn(
            `[RETRY] Received 429 (Too Many Requests). Retrying in ${backoffTime}ms... (${i + 1}/${MAX_RETRIES})`
          );
          await sleep(backoffTime);
        } else {
          // If it's not a 429 error, re-throw it immediately.
          throw err;
        }
      }
    }
    // If all retries fail, throw the last captured error.
    console.error(`[RETRY] All ${MAX_RETRIES} retries failed.`);
    throw lastError;
  };
}

module.exports = { withRetry };
