// ─── Cloud Run service-to-service auth ─────────────────────────────────────
// Backends deploy with allow_unauthenticated = false, so Cloud Run refuses a call
// at its edge (403, before the container runs) unless it carries a Google-signed
// ID token whose audience is the target's URL, from a service account that holds
// run.invoker on the target (infra/terraform/modules/deployment/iam.tf).
//
// The token comes straight from the metadata server, so no client library is
// needed. Off Google Cloud (local development, tests) there is no metadata server
// and the URLs are plain http://localhost ones, so no token is asked for. Both a
// service (K_SERVICE) and a scheduled job (CLOUD_RUN_JOB) count as on Cloud Run.

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
