import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bookingRoutes from './routes/booking.routes.js';
import { extractUser } from './middleware/auth.js';
import errorHandler from './middleware/errorHandler.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import logger from './config/logger.js';
import { installTenantFetch, tenantMiddleware } from '../../shared/tenancy/src/index.js';

const app = express();
const PORT = process.env.PORT || 3005;

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
// Request ID + structured logging (replaces morgan)
app.use(correlationId);
app.use(requestLogger);
// Every request runs inside the agency the gateway took from the login.
app.use(tenantMiddleware);
// Calls to our other services carry the same agency.
installTenantFetch();
app.use(express.json());
app.use(cookieParser());
app.use(extractUser);

app.use('/api/v1/bookings', bookingRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'booking-service' }));
app.use(errorHandler);

app.listen(PORT, () => logger.info({ port: PORT }, 'booking-service started'));
