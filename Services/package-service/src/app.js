import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { extractUser } from './middleware/auth.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import packageRoutes from './routes/package.routes.js';
import reviewRoutes from './routes/review.routes.js';
import hotelSuggestionRoutes from './routes/hotelSuggestion.routes.js';
import hotelBookingRoutes from './hotels/routes/hotelBooking.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import { installTenantFetch, tenantMiddleware } from '../../shared/tenancy/src/index.js';

const app = express();
const V1 = '/api/v1';

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(correlationId);
app.use(requestLogger);
// Every request runs inside the agency the gateway took from the login.
app.use(tenantMiddleware);
// Calls to our other services carry the same agency.
installTenantFetch();
app.use(extractUser);

app.use(`${V1}/packages`, packageRoutes);
app.use(`${V1}/reviews`, reviewRoutes);
app.use(`${V1}/hotels`, hotelSuggestionRoutes);
app.use(`${V1}/hotels`, hotelBookingRoutes);
app.use(`${V1}/upload`, uploadRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'package-service' }));
app.use(errorHandler);

export default app;
