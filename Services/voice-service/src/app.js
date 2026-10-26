import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import webhookRoutes from './routes/webhook.routes.js';
import callRoutes from './routes/call.routes.js';
import toolRoutes from './routes/tool.routes.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));

// rawBody is required for ElevenLabs' HMAC signature check, which is computed
// over the exact bytes sent.
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.use(correlationId);
app.use(requestLogger);

app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'voice-service', timestamp: new Date().toISOString() })
);
app.use('/api/v1/webhooks/voice/fn', toolRoutes);
app.use('/api/v1/webhooks/voice', webhookRoutes);
app.use('/api/v1/voice', callRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.path}` }));
app.use(errorHandler);

export default app;
