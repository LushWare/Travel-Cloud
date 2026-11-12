import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runWithTenant } from '../context.js';
import { tenantLogFields, tenantRequestLogFields } from '../logging.js';

const AGENCY = '00000000-0000-4000-8000-000000000002';
const SERVICES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
// No agency context of their own: the gateway logs the agency it verified, platform-service is Lushware-only.
const NOT_AGENCY_AWARE = new Set(['gateway', 'platform-service']);

describe('tenantLogFields', () => {
  it('adds the agency to log lines written while handling an agency request', () => {
    expect(runWithTenant(AGENCY, () => tenantLogFields())).toEqual({ tenantId: AGENCY });
  });

  it('adds the request id to agency log lines', () => {
    expect(runWithTenant(AGENCY, () => tenantLogFields(), 'request-123'))
      .toEqual({ tenantId: AGENCY, requestId: 'request-123' });
  });

  describe('tenantRequestLogFields', () => {
    it('attributes request logs to a valid gateway tenant id', () => {
      expect(tenantRequestLogFields({ headers: { 'x-tenant-id': AGENCY } })).toEqual({ tenantId: AGENCY });
    });

    it('includes the request correlation id in request log fields', () => {
      expect(tenantRequestLogFields({ headers: {}, requestId: 'request-123' })).toEqual({ requestId: 'request-123' });
    });

    it('does not attribute missing or malformed tenant ids', () => {
      expect(tenantRequestLogFields({ headers: {} })).toEqual({});
      expect(tenantRequestLogFields({ headers: { 'x-tenant-id': 'not-a-tenant' } })).toEqual({});
    });
  });

  it('adds nothing outside an agency, so no line is attributed to one by mistake', () => {
    expect(tenantLogFields()).toEqual({});
  });
});

describe('service loggers', () => {
  const services = readdirSync(SERVICES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(SERVICES_DIR, d.name, 'src/config/logger.js')))
    .map((d) => d.name)
    .filter((name) => !NOT_AGENCY_AWARE.has(name));

  it('finds the services to check', () => {
    expect(services.length).toBeGreaterThanOrEqual(12);
  });

  it.each(services)('%s adds the agency to every log line', (name) => {
    const source = readFileSync(path.join(SERVICES_DIR, name, 'src/config/logger.js'), 'utf8');

    expect(source).toMatch(/\.\.\.tenantLogFields\(\)/);
  });

  it.each(services)('%s adds the verified agency to request log lines', (name) => {
    const source = readFileSync(path.join(SERVICES_DIR, name, 'src/middleware/requestLogger.js'), 'utf8');

    expect(source).toMatch(/tenantRequestLogFields/);
    expect(source).toMatch(/customProps:\s*tenantRequestLogFields/);
  });

  it.each(services)('%s marks missing agency context errors for Cloud Logging alerts', (name) => {
    const source = readFileSync(path.join(SERVICES_DIR, name, 'src/middleware/errorHandler.js'), 'utf8');

    expect(source).toMatch(/alertType:\s*'missing_tenant_context'/);
    expect(source).toMatch(/errorCode:\s*err\.code/);
  });
});
