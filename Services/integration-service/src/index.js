import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import { tenantMiddleware } from '../../shared/tenancy/src/index.js';
import { tenantDb } from './db.js';
import logger from './config/logger.js';
import errorHandler from './middleware/errorHandler.js';
import routes from './routes.js';
import facebookWebhookRoutes from './facebook.webhook.routes.js';
import stripeWebhookRoutes from './stripe.webhook.routes.js';

const app = express();
const PORT = process.env.PORT || 3015;
const V1 = '/api/v1';

app.use(helmet());
app.use(cors({ origin: process.env.MANAGEMENT_URL || '*', credentials: true }));
app.use(correlationId);
app.use(requestLogger);
app.use(tenantMiddleware);
app.use((req, _res, next) => {
  req.db = tenantDb;
  next();
});
app.use(
  `${V1}/webhooks/facebook`,
  express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }),
  facebookWebhookRoutes,
);
app.use(`${V1}/webhooks/stripe`, express.raw({ type: 'application/json' }), stripeWebhookRoutes);
app.use(`${V1}/integrations`, express.json({ limit: '15mb' }), routes);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'integration-service' }));
app.use(errorHandler);

app.listen(PORT, () => logger.info({ port: PORT }, 'integration-service started'));
