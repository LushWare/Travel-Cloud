import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import errorHandler from './middleware/errorHandler.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import leadRoutes from './routes/lead.routes.js';
import customizedPackageRoutes from './routes/customizedPackage.routes.js';
import manualItineraryRoutes from './routes/manualItinerary.routes.js';
import { installTenantFetch, tenantMiddleware } from '../../shared/tenancy/src/index.js';

// The Express app, built without starting a server or connecting to the DB so
// it can be imported directly by supertest. `src/index.js` owns the lifecycle.
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
  res.json({ status: 'ok', service: 'lead-service', timestamp: new Date().toISOString() })
);

app.use('/api/v1/leads', leadRoutes);
app.use('/api/v1/customized-packages', customizedPackageRoutes);
app.use('/api/v1/manual-itineraries', manualItineraryRoutes);
app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.path}` }));
app.use(errorHandler);

export default app;
