import { domainAuthHeader } from './utils/cloudRunAuth.js';

const analyticsServiceUrl = () => process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3009';

export async function fetchBusinessSignals(actor, requestId) {
  const baseUrl = analyticsServiceUrl();
  const auth = await domainAuthHeader(baseUrl);
  const response = await fetch(new URL('/api/v1/analytics/business/signals', baseUrl), {
    headers: {
      'x-user-id': actor.id,
      'x-user-role': actor.role,
      'x-user-permissions': JSON.stringify(actor.permissions),
      'x-user-is-super-admin': String(actor.isSuperAdmin),
      'x-request-id': requestId || '',
      ...auth,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`Business signals unavailable (${response.status})`);
  const envelope = await response.json();
  if (!envelope?.success || !envelope?.data?.signals || !['own', 'org'].includes(envelope.data.scope)) {
    throw new Error('Business signals response is malformed');
  }
  return envelope.data;
}