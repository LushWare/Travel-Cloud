import pinoHttp from 'pino-http';
import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger.js';
import { tenantRequestLogFields } from '../../../shared/tenancy/src/logging.js';

export const correlationId = (req, res, next) => {
  const id = req.headers['x-request-id'] || uuidv4();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};

export const requestLogger = pinoHttp({
  logger,
  customProps: tenantRequestLogFields,
  genReqId: (req) => req.headers['x-request-id'] || uuidv4(),
  quietReqLogger: true,
  autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/favicon.ico' },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage(req, res, err) {
    return `${req.method} ${req.url} ${res.statusCode} — ${err.message}`;
  },
});
