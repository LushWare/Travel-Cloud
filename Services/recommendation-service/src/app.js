import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import recommendationsRoutes from './routes/recommendations.routes.js';

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(pinoHttp({ logger, autoLogging: false }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'recommendation-service' }));
app.use('/api/v1/recommendations', recommendationsRoutes);
app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.path}` }));
app.use((error, req, res, _next) => {
  req.log?.error({ err: error, diagnostic: error.diagnostic }, 'Recommendation request failed');
  const status = error.statusCode === 503 ? 503 : 500;
  const message = status === 503
    ? error.message
    : 'Recommendation service temporarily unavailable';
  return res.status(status).json({ success: false, message });
});

export default app;