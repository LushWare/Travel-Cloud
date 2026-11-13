import pino from 'pino';
import { tenantLogFields } from '../../../shared/tenancy/src/logging.js';

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  redact: {
    paths: [
      'password', 'token', 'authorization', 'username', 'smtpPassword', 'secret',
      'req.headers.cookie', 'req.headers.authorization', 'req.headers.x-internal-token',
    ],
    censor: '[REDACTED]',
  },
  mixin() {
    return {
      service: 'integration-service',
      env: process.env.NODE_ENV || 'development',
      ...tenantLogFields(),
    };
  },
  ...(isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});

export default logger;
