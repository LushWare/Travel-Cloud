import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTenantFetch, internalOrigins, runWithTenant, withTenantHeader } from '../index.js';

const A = '11111111-1111-4111-8111-111111111111';
const env = { LEAD_SERVICE_URL: 'http://localhost:3004', USER_SERVICE_URL: 'https://user-xyz.a.run.app/', OTHER: 'http://evil.test' };
const headerOf = (init) => new Headers(init?.headers).get('x-tenant-id');

describe('internalOrigins', () => {
  it('collects the origins of our own services only', () => {
    expect([...internalOrigins(env)]).toEqual(['http://localhost:3004', 'https://user-xyz.a.run.app']);
  });

  it('skips malformed settings', () => {
    expect(internalOrigins({ BAD_SERVICE_URL: 'not a url' }).size).toBe(0);
  });
});

describe('withTenantHeader', () => {
  it('adds the agency to a call to one of our services', () => {
    const init = withTenantHeader('http://localhost:3004/api/v1/leads', {}, { tenantId: A, env });

    expect(headerOf(init)).toBe(A);
  });

  it('keeps the caller\'s own headers', () => {
    const init = withTenantHeader('http://localhost:3004/x', { headers: { 'x-internal-token': 't' } }, { tenantId: A, env });

    expect(new Headers(init.headers).get('x-internal-token')).toBe('t');
  });

  it('never sends the agency to an outside company', () => {
    const init = { headers: { a: '1' } };

    expect(withTenantHeader('https://api.duffel.com/air/orders', init, { tenantId: A, env })).toBe(init);
  });

  it('does not treat a lookalike host as ours', () => {
    expect(withTenantHeader('http://localhost:30040/x', {}, { tenantId: A, env })).toEqual({});
  });

  it('adds nothing outside a request', () => {
    expect(withTenantHeader('http://localhost:3004/x', {}, { tenantId: null, env })).toEqual({});
  });

  it('does not overwrite an agency the caller set on purpose', () => {
    const init = withTenantHeader('http://localhost:3004/x', { headers: { 'x-tenant-id': 'chosen' } }, { tenantId: A, env });

    expect(headerOf(init)).toBe('chosen');
  });

  it('works with URL objects', () => {
    expect(headerOf(withTenantHeader(new URL('http://localhost:3004/x'), undefined, { tenantId: A, env }))).toBe(A);
  });
});

describe('installTenantFetch', () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
    delete process.env.LEAD_SERVICE_URL;
  });

  it('makes plain fetch calls inside a request carry the agency', async () => {
    const spy = vi.fn().mockResolvedValue('ok');
    globalThis.fetch = spy;
    process.env.LEAD_SERVICE_URL = 'http://localhost:3004';
    installTenantFetch();

    await runWithTenant(A, () => fetch('http://localhost:3004/api/v1/leads'));

    expect(headerOf(spy.mock.calls[0][1])).toBe(A);
  });

  it('wraps fetch only once', () => {
    globalThis.fetch = vi.fn();
    installTenantFetch();
    const once = globalThis.fetch;
    installTenantFetch();

    expect(globalThis.fetch).toBe(once);
  });
});
