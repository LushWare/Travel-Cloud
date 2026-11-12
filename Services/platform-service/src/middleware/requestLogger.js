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
export const requestLogger = pinoHttp({
  logger,
  useLevel: 'info',
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
 * Request ID middleware — sets correlation ID header on response.
 * Runs before pino-http to ensure the ID is available early.
 */
export const correlationId = (req, res, next) => {
  const id = req.headers['x-request-id'] || uuidv4();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};
