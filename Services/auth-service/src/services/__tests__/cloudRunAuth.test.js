import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearCloudRunAuthCache, cloudRunAuthHeader, onCloudRun } from '../cloudRunAuth.js';

const jwtExpiringAt = (seconds) => `h.${Buffer.from(JSON.stringify({ exp: seconds })).toString('base64url')}.s`;
const tokenResponse = (token) => ({ ok: true, text: async () => `${token}\n` });

beforeEach(() => clearCloudRunAuthCache());
afterEach(() => vi.unstubAllEnvs());

describe('cloudRunAuthHeader', () => {
  it('asks for no token off Google Cloud', async () => {
    vi.stubEnv('K_SERVICE', '');
    vi.stubEnv('CLOUD_RUN_JOB', '');
    const fetchImpl = vi.fn();

    expect(await cloudRunAuthHeader('http://localhost:3008/x', { fetchImpl })).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats a scheduled Cloud Run job as on Cloud Run', () => {
    vi.stubEnv('K_SERVICE', '');
    vi.stubEnv('CLOUD_RUN_JOB', 'prod-billing-lifecycle');

    expect(onCloudRun()).toBe(true);
  });

  it('asks the metadata server for a token for the target service only', async () => {
    vi.stubEnv('K_SERVICE', 'prod-auth-service');
    const fetchImpl = vi.fn().mockResolvedValue(tokenResponse(jwtExpiringAt(4_000_000_000)));

    const header = await cloudRunAuthHeader('https://notification-abc.a.run.app/api/v1/notifications/internal/email', { fetchImpl });

    expect(header.Authorization).toMatch(/^Bearer h\./);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('audience=https%3A%2F%2Fnotification-abc.a.run.app&');
    expect(init.headers).toEqual({ 'Metadata-Flavor': 'Google' });
  });

  it('reuses a token until shortly before it expires', async () => {
    vi.stubEnv('K_SERVICE', 'prod-auth-service');
    const fetchImpl = vi.fn().mockResolvedValue(tokenResponse(jwtExpiringAt(2_000)));
    const target = 'https://notification-abc.a.run.app/email';

    await cloudRunAuthHeader(target, { fetchImpl, now: () => 1_000_000 });
    await cloudRunAuthHeader(target, { fetchImpl, now: () => 1_200_000 });
    await cloudRunAuthHeader(target, { fetchImpl, now: () => 1_800_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails loudly when no token can be had', async () => {
    vi.stubEnv('K_SERVICE', 'prod-auth-service');
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' });

    await expect(cloudRunAuthHeader('https://n.a.run.app/x', { fetchImpl })).rejects.toThrow(/status 404/);
  });
});
