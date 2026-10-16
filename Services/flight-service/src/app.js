import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import flightRoutes from './routes/flight.routes.js';
import leadFlightRoutes from './routes/leadFlight.routes.js';
import duffelWebhookRoutes from './routes/duffelWebhook.routes.js';
import { extractUser } from './middleware/auth.js';
import { injectFlightClient } from './middleware/flightClient.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import logger from './config/logger.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({
	verify: (req, _res, buffer) => {
		req.rawBody = Buffer.from(buffer);
	},
}));
app.use(cookieParser());

// Request ID + structured logging (replaces morgan)
app.use(correlationId);
app.use(requestLogger);

app.use(extractUser);
app.use(injectFlightClient);

app.use('/api/v1/webhooks/duffel-flights', duffelWebhookRoutes);
app.use('/api/v1/flights', flightRoutes);
app.use('/api/v1/flights', leadFlightRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'flight-service' }));
app.use(errorHandler);

export default app;
