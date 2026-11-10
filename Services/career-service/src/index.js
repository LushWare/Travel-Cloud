import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import errorHandler from './middleware/errorHandler.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import logger from './config/logger.js';
import careerRoutes from './routes/career.routes.js';
import vacancyRoutes from './routes/vacancy.routes.js';
import prisma from './db/client.js';
import { installTenantFetch, tenantMiddleware } from '../../shared/tenancy/src/index.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request ID + structured logging (replaces morgan)
app.use(correlationId);
app.use(requestLogger);
// Every request runs inside the agency the gateway took from the login.
app.use(tenantMiddleware);
// Calls to our other services carry the same agency.
installTenantFetch();

app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'career-service', timestamp: new Date().toISOString() })
);

app.use('/api/v1/careers',   careerRoutes);
app.use('/api/v1/vacancies', vacancyRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.path}` }));
app.use(errorHandler);

const PORT = process.env.PORT || 3007;
const start = async () => {
  await prisma.$connect();
  app.listen(PORT, '0.0.0.0', () =>
    logger.info({ port: PORT }, 'career-service started')
  );
};
start().catch((err) => { logger.error({ err }, 'career-service startup error'); process.exit(1); });

export default app;
