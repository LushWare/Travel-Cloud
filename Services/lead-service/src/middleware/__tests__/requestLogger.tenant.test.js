import { describe, it, expect } from 'vitest';
import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import request from 'supertest';
import { Writable } from 'node:stream';
import { tenantMiddleware } from '../../../../shared/tenancy/src/index.js';
import { tenantLogFields } from '../../../../shared/tenancy/src/logging.js';

const AGENCY = '00000000-0000-4000-8000-000000000002';

// Same wiring as src/app.js and src/config/logger.js, writing JSON to memory instead of stdout.
function appLoggingTo(lines) {
  const sink = new Writable({ write(chunk, _enc, cb) { lines.push(JSON.parse(chunk.toString())); cb(); } });
  const logger = pino({ mixin: () => ({ service: 'lead-service', ...tenantLogFields() }) }, sink);
  const app = express();
  app.use(pinoHttp({ logger, quietReqLogger: true }));
  app.use(tenantMiddleware);
  app.get('/slow', async (req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    req.log.info('after async work');
    res.json({ ok: true });
  });
  return app;
}

describe('request logging per agency', () => {
  it('puts the agency on lines written during the request, even after async work', async () => {
    const lines = [];

    await request(appLoggingTo(lines)).get('/slow').set('x-tenant-id', AGENCY);

    expect(lines.find((l) => l.msg === 'after async work').tenantId).toBe(AGENCY);
  });

  it('puts the agency on the request-completed line', async () => {
    const lines = [];

    await request(appLoggingTo(lines)).get('/slow').set('x-tenant-id', AGENCY);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(lines.find((l) => l.msg === 'request completed').tenantId).toBe(AGENCY);
  });

  it('leaves the agency off a request that carries none', async () => {
    const lines = [];

    await request(appLoggingTo(lines)).get('/slow');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(lines.every((l) => !('tenantId' in l))).toBe(true);
  });
});
