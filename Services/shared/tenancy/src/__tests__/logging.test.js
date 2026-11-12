import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runWithTenant } from '../context.js';
import { tenantLogFields } from '../logging.js';

const AGENCY = '00000000-0000-4000-8000-000000000002';
const SERVICES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
// No agency context of their own: the gateway logs the agency it verified, platform-service is Lushware-only.
const NOT_AGENCY_AWARE = new Set(['gateway', 'platform-service']);

describe('tenantLogFields', () => {
  it('adds the agency to log lines written while handling an agency request', () => {
    expect(runWithTenant(AGENCY, () => tenantLogFields())).toEqual({ tenantId: AGENCY });
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
});
