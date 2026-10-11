import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

/**
 * Structured JSON logger (pino).
 *
 * Dev:  pretty-printed via pino-pretty transport
 * Prod: newline-delimited JSON to stdout (→ Loki / Datadog / ELK)
 *
 * Redacts sensitive fields automatically.
 */
const logger = pino({
  level,
  redact: {
    paths: [
      'password', 'token', 'authorization', 'email',
      'req.headers.cookie', 'req.headers.authorization', 'req.headers.x-internal-token',
      'passportNumber', 'creditCard',
    ],
    censor: '[REDACTED]',
  },
  mixin() {
    return {
      service: 'flight-service',
      env: process.env.NODE_ENV || 'development',
    };
  },
  ...(isProduction
    ? {}  // raw JSON to stdout
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' },
        },
      }),
});

export default logger;
