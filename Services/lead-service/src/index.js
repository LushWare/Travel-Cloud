import 'dotenv/config';

import app from './app.js';
import prisma from './db/client.js';
import logger from './config/logger.js';
import { connectWithRetry } from './utils/connect-with-retry.js';

const PORT = process.env.PORT || 3004;
const start = async () => {
  await connectWithRetry(() => prisma.$connect(), logger);
  app.listen(PORT, '0.0.0.0', () =>
    logger.info({ port: PORT }, 'lead-service started')
  );
};
start().catch((err) => { logger.error({ err }, 'Failed to start lead-service'); process.exit(1); });

export default app;
