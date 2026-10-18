import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import assistantRoutes from './routes/assistant.routes.js';
import eventsRoutes from './routes/events.routes.js';
import managementNotificationsRoutes from './routes/managementNotifications.routes.js';
import managementNotificationsSeenRoutes from './routes/managementNotificationsSeen.routes.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Request ID + structured logging (replaces morgan)
app.use(correlationId);
app.use(requestLogger);

app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'assistant-service', timestamp: new Date().toISOString() })
);

app.use('/api/v1/assistant/turn', assistantRoutes);
app.use('/api/v1/assistant/events', eventsRoutes);
app.use('/api/v1/assistant/management/notifications', managementNotificationsRoutes);
app.use('/api/v1/assistant/management/notifications/seen', managementNotificationsSeenRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.path}` }));
app.use(errorHandler);

export default app;
