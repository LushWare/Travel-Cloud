import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCloudRunAuthCache } from '../cloudRunAuth.js';
import { getOrgSettings, _resetCache } from '../../config/orgSettings.js';

// On Cloud Run the target refuses any call without a Google ID token (403 at its edge),
// so every service-to-service call must carry one from the metadata server.
const ID_TOKEN = 'header.e30.signature';

describe('billing-service branding from user-service', () => {
  beforeEach(() => {
    clearCloudRunAuthCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => ID_TOKEN })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearCloudRunAuthCache();
  });

  it('sends a Google ID token for user-service when running on Cloud Run', async () => {
    vi.stubEnv('K_SERVICE', 'prod-billing-service');
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: { settings: {} } }) }));

    await (_resetCache(), getOrgSettings({ fetchImpl }));

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${ID_TOKEN}`);
  });

  it('sends no Authorization header outside Cloud Run', async () => {
    vi.stubEnv('K_SERVICE', '');
    vi.stubEnv('CLOUD_RUN_JOB', '');
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: { settings: {} } }) }));

    await (_resetCache(), getOrgSettings({ fetchImpl }));

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
