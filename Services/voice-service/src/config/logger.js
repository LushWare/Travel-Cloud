import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const logger = pino({
  level,
  redact: {
    paths: [
      'password', 'token', 'authorization', 'email',
      'req.headers.cookie', 'req.headers.authorization', 'req.headers.x-internal-token',
      'req.headers["elevenlabs-signature"]', 'req.headers["x-elevenlabs-init-secret"]',
      'req.headers["x-elevenlabs-tool-secret"]',
      'transcript', 'recordingUrl', 'recording_url',
    ],
    censor: '[REDACTED]',
  },
  mixin() {
    return { service: 'voice-service', env: process.env.NODE_ENV || 'development' };
  },
  ...(isProduction ? {} : {
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' } },
  }),
});

export default logger;
