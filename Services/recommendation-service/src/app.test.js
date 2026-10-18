import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from './app.js';
import prisma from './db/client.js';

afterAll(async () => prisma.$disconnect());

describe('recommendation API access boundary', () => {
  it('reports service health without exposing recommendation data', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'recommendation-service' });
  });

  it('requires Gateway-forwarded management identity for recommendations', async () => {
    const response = await request(app).get('/api/v1/recommendations');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false, message: 'Not authorized' });
  });
});