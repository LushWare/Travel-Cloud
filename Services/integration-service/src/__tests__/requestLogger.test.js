import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requestLogger } from '../middleware/requestLogger.js';

describe('integration request logger', () => {
  it('serializes requests carrying Stripe bearer tokens without failing', async () => {
    const app = express();
    app.use(requestLogger);
    app.get('/api/v1/integrations/stripe/payment-links/:token', (_req, res) => res.sendStatus(200));

    await request(app)
      .get(`/api/v1/integrations/stripe/payment-links/${'a'.repeat(43)}`)
      .expect(200);
  });
});
