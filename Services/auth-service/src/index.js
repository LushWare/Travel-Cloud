import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.routes.js';
import errorHandler from './middleware/errorHandler.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import logger from './config/logger.js';
import { assertSigningKeyConfigured } from './config/jwtKeys.js';
import { receiveStripeBillingWebhook } from './controllers/billing.controller.js';

assertSigningKeyConfigured();

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(correlationId);
app.use(requestLogger);
app.post('/api/v1/webhooks/stripe-billing', express.raw({ type: 'application/json', limit: '1mb' }), receiveStripeBillingWebhook);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'auth-service', timestamp: new Date().toISOString() })
);

app.use('/api/v1/auth', authRoutes);

app.use((req, res) =>
  res.status(404).json({ success: false, message: `Route not found: ${req.path}` })
);

app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () =>
  logger.info({ port: PORT }, 'auth-service started')
);

export default app;
