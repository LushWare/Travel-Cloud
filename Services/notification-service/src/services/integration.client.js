import { getRequestId, getTenantId } from '../../../shared/tenancy/src/context.js';
import { getCloudRunAuthorization } from './cloudRunAuth.js';

export async function sendWithAgencyEmail(message, fetchImpl = fetch) {
  const tenantId = getTenantId();
  const baseUrl = process.env.INTEGRATION_SERVICE_URL?.replace(/\/+$/, '');
  if (!tenantId || !baseUrl) return null;

  const url = `${baseUrl}/api/v1/integrations/internal/email/send`;
  const authHeaders = await getCloudRunAuthorization(baseUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
      'x-request-id': getRequestId() || '',
      'x-internal-token': process.env.INTERNAL_EVENTS_TOKEN || '',
      ...authHeaders,
    },
    body: JSON.stringify(message),
  });

  if (response.status === 404) {
    const result = await response.json();
    if (result?.code === 'INTEGRATION_NOT_CONNECTED') return null;
  }
  if (!response.ok) {
    throw new Error(`Integration service email delivery failed with status ${response.status}`);
  }
  const result = await response.json();
  return result.data;
}

export async function sendWithAgencyWhatsapp(message, fetchImpl = fetch) {
  const tenantId = getTenantId();
  const baseUrl = process.env.INTEGRATION_SERVICE_URL?.replace(/\/+$/, '');
  if (!tenantId || !baseUrl) return null;

  const url = `${baseUrl}/api/v1/integrations/internal/whatsapp/send`;
  const authHeaders = await getCloudRunAuthorization(baseUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
      'x-request-id': getRequestId() || '',
      'x-internal-token': process.env.INTERNAL_EVENTS_TOKEN || '',
      ...authHeaders,
    },
    body: JSON.stringify(message),
  });

  if (response.status === 404) {
    const result = await response.json();
    if (result?.code === 'INTEGRATION_NOT_CONNECTED') return null;
  }
  if (!response.ok) {
    throw new Error(`Integration service WhatsApp delivery failed with status ${response.status}`);
  }
  const result = await response.json();
  return result.data;
}

export async function resolveWhatsappTenant(phoneNumberId, fetchImpl = fetch) {
  const baseUrl = process.env.INTEGRATION_SERVICE_URL?.replace(/\/+$/, '');
  if (!baseUrl || !/^\d{1,30}$/.test(String(phoneNumberId || ''))) return null;

  const authHeaders = await getCloudRunAuthorization(baseUrl);
  const response = await fetchImpl(`${baseUrl}/api/v1/integrations/internal/whatsapp/resolve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': getRequestId() || '',
      'x-internal-token': process.env.INTERNAL_EVENTS_TOKEN || '',
      ...authHeaders,
    },
    body: JSON.stringify({ phoneNumberId }),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Integration service WhatsApp routing failed with status ${response.status}`);
  }
  const result = await response.json();
  return result?.data?.tenantId || null;
}

export async function verifyGoogleAdsWebhookKey({ tenantId, googleKey }, fetchImpl = fetch) {
  const baseUrl = process.env.INTEGRATION_SERVICE_URL?.replace(/\/+$/, '');
  if (!tenantId || !baseUrl) throw new Error('Google Ads integration verification is unavailable');

  const url = `${baseUrl}/api/v1/integrations/internal/google-ads/${encodeURIComponent(tenantId)}/verify`;
  const authHeaders = await getCloudRunAuthorization(baseUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenantId,
      'x-internal-token': process.env.INTERNAL_EVENTS_TOKEN || '',
      ...authHeaders,
    },
    body: JSON.stringify({ google_key: googleKey }),
  });
  if (response.status === 401) return false;
  if (!response.ok) {
    throw new Error(`Google Ads integration verification failed with status ${response.status}`);
  }
  const result = await response.json();
  return result?.data?.tenantId === tenantId;
}
