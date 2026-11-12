import pinoHttp from 'pino-http';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger.js';

/**
 * pino-http middleware — replaces morgan.
 *
 * Injects:
 *   req.requestId  — unique correlation ID per request
 *   req.log        — child logger with requestId bound
 *
 * Skips logging for health checks.
 * Auto-redacts sensitive headers/query params.
 */
/**
 * The agency a request was handled for, on its "request completed" line.
 *
 * pino-http calls this twice: when the request arrives (before the gateway strips client-sent
 * headers) and when the line is written. So it never reads the x-tenant-id header, which a
 * client could set; it reads `req.verifiedTenantId`, which only the gateway's auth step sets,
 * from the verified login or the public-website pin.
 */
export function requestLogProps(req) {
  return {
    ...(req.verifiedTenantId ? { tenantId: req.verifiedTenantId } : {}),
    ...(req.requestId ? { requestId: req.requestId } : {}),
  };
}

export const requestLogger = pinoHttp({
  logger,
  useLevel: 'info',
  customProps: requestLogProps,
  genReqId: (req) => req.headers['x-request-id'] || uuidv4(),

  quietReqLogger: true,

  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/favicon.ico',
  },

  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode} — ${res.getHeader('x-response-time')}`;
  },
  customErrorMessage(req, res, err) {
    return `${req.method} ${req.url} ${res.statusCode} — ${err.message}`;
  },
});

/**
 * Request ID middleware — the gateway is where correlation IDs originate for
 * the whole system, so this mutates req.headers (not just req.requestId) —
 * http-proxy-middleware forwards req.headers as-is, so downstream services
 * pick the same x-request-id back up via their own correlationId middleware.
 */
export const correlationId = (req, res, next) => {
  const id = req.headers['x-request-id'] || uuidv4();
  req.requestId = id;
  req.headers['x-request-id'] = id;
  res.setHeader('x-request-id', id);
  next();
};
