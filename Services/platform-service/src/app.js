import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import errorHandler from './middleware/errorHandler.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import authRoutes from './routes/auth.routes.js';
import agencyRoutes from './routes/agencies.routes.js';
import staffRoutes from './routes/staff.routes.js';
import planRoutes from './routes/plans.routes.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(correlationId);
app.use(requestLogger);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'platform-service' }));

app.use('/api/v1/platform/auth', authRoutes);
app.use('/api/v1/platform/agencies', agencyRoutes);
app.use('/api/v1/platform/plans', planRoutes);
app.use('/api/v1/platform/staff', staffRoutes);

app.use((req, res) => res.status(404).json({
  success: false, status: 'fail', code: 'NOT_FOUND', message: "We couldn't find what you were looking for.",
  ...(req.requestId && { requestId: req.requestId }),
}));
app.use(errorHandler);

export default app;
