import { resolveFlightClient } from '../clients/index.js';

/**
 * Middleware that injects the current agency's flight API client onto the request object.
 * Use `req.flightClient` in controllers instead of importing provider-specific code.
 */
export const injectFlightClient = async (req, res, next) => {
  try {
    req.flightClient = await resolveFlightClient();
    next();
  } catch (error) {
    next(error);
  }
};
