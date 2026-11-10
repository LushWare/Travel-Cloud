import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import errorHandler from './middleware/errorHandler.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import logger from './config/logger.js';
import webhookRoutes from './routes/webhook.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import { installTenantFetch, tenantMiddleware } from '../../shared/tenancy/src/index.js';

const app = express();
const PORT = process.env.PORT || 3008;
const V1 = '/api/v1';

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
// Request ID + structured logging (replaces morgan)
app.use(correlationId);
app.use(requestLogger);
// Every request runs inside the agency the gateway took from the login.
app.use(tenantMiddleware);
// Calls to our other services carry the same agency.
installTenantFetch();

// `verify` stashes the raw bytes on req.rawBody so webhook handlers can check
// Meta's X-Hub-Signature-256 against what was actually signed, not a
// re-serialized JSON.stringify(req.body) (which can silently mismatch).
app.use(
  `${V1}/webhooks`,
  express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }),
  webhookRoutes
);
// Higher limit than the default 100kb — internal/email accepts base64-encoded PDF attachments.
app.use(`${V1}/notifications`, express.json({ limit: '15mb' }), notificationRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'notification-service' }));
app.use(errorHandler);

app.listen(PORT, () => logger.info({ port: PORT }, 'notification-service started'));
