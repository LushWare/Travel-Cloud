import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { extractUser } from './middleware/auth.js';
import errorHandler from './middleware/errorHandler.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import userRoutes from './routes/user.routes.js';
import adminRoutes from './routes/admin.routes.js';
import salesRepRoutes from './routes/salesRep.routes.js';
import vendorRoutes from './routes/vendor.routes.js';
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

// Extract user context from gateway headers
app.use(extractUser);

app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'user-service', timestamp: new Date().toISOString() })
);

app.use('/api/v1/users',      userRoutes);
app.use('/api/v1/admin',      adminRoutes);
app.use('/api/v1/sales-reps', salesRepRoutes);
app.use('/api/v1/vendors',    vendorRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.path}` }));
app.use(errorHandler);

export default app;
