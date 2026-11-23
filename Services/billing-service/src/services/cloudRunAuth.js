const METADATA_IDENTITY = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
const REFRESH_EARLY_MS = 5 * 60 * 1000;
const cache = new Map();

export const onCloudRun = () => Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB);

const audienceOf = (url) => new URL(url).origin;

/** { Authorization: 'Bearer …' } for a call to `url` on Cloud Run, or {} anywhere else. */
export async function cloudRunAuthHeader(url, { fetchImpl = fetch, now = Date.now } = {}) {
  if (!onCloudRun()) return {};
  const audience = audienceOf(url);
  const cached = cache.get(audience);
  if (cached && cached.expiresAt - REFRESH_EARLY_MS > now()) return { Authorization: `Bearer ${cached.token}` };

  const response = await fetchImpl(`${METADATA_IDENTITY}?audience=${encodeURIComponent(audience)}&format=full`, {
    headers: { 'Metadata-Flavor': 'Google' },
  });
  if (!response.ok) throw new Error(`Could not get a Cloud Run ID token for ${audience} (status ${response.status})`);
  const token = (await response.text()).trim();

  // The token's own expiry, so it is reused for most of its hour instead of fetched per call.
  let expiresAt = now() + 10 * 60 * 1000;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (Number.isFinite(payload.exp)) expiresAt = payload.exp * 1000;
  } catch { /* keep the short default */ }
  cache.set(audience, { token, expiresAt });
  return { Authorization: `Bearer ${token}` };
}

export const clearCloudRunAuthCache = () => cache.clear();
