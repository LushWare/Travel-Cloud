const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

const isTransientDatabaseError = (error) =>
  error?.errorCode === 'P1001' || error?.errorCode === 'P1002';

export async function connectWithRetry(connect, logger, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let retryDelayMs = INITIAL_RETRY_DELAY_MS;

  while (true) {
    try {
      await connect();
      return;
    } catch (error) {
      if (!isTransientDatabaseError(error)) {
        throw error;
      }

      logger.warn(
        { err: error, retryInMs: retryDelayMs },
        'Database is unavailable; retrying lead-service startup'
      );
      await wait(retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    }
  }
}
