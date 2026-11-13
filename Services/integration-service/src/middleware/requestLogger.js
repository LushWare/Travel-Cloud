import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import logger from '../config/logger.js';
import { tenantRequestLogFields } from '../../../shared/tenancy/src/logging.js';

export const correlationId = (req, res, next) => {
  const id = req.headers['x-request-id'] || randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};

export const requestLogger = pinoHttp({
  logger,
  customProps: tenantRequestLogFields,
  useLevel: 'info',
  genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
  quietReqLogger: true,
  autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/favicon.ico' },
});
