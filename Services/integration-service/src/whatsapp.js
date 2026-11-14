import { z } from 'zod';

const META_API = 'https://graph.facebook.com';
const phoneNumberIdSchema = z.string().regex(/^\d{1,30}$/);

export class WhatsappApiError extends Error {
  constructor(status, code) {
    super(`Meta WhatsApp API request failed with status ${status}`);
    this.name = 'WhatsappApiError';
    this.status = status;
    this.providerCode = code || null;
  }
}

function graphVersion() {
  const version = process.env.FACEBOOK_GRAPH_API_VERSION || 'v27.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('Meta Graph API version is invalid');
  return version;
}

function appConfig() {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Meta WhatsApp integration is not configured');
  return { appId, appSecret };
}

async function graphRequest(path, { method = 'GET', accessToken, params = {}, body } = {}) {
  const url = new URL(`${META_API}/${graphVersion()}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) {
    throw new WhatsappApiError(response.status, result?.error?.code);
  }
  return result;
}

export async function exchangeWhatsappSignupCode(code) {
  const { appId, appSecret } = appConfig();
  const result = await graphRequest('oauth/access_token', {
    params: { client_id: appId, client_secret: appSecret, code },
  });
  if (typeof result.access_token !== 'string' || !result.access_token) {
    throw new Error('Meta did not return a WhatsApp business token');
  }
  return result.access_token;
}

export async function getWhatsappPhoneNumber(wabaId, phoneNumberId, accessToken) {
  phoneNumberIdSchema.parse(phoneNumberId);
  const result = await graphRequest(`${wabaId}/phone_numbers`, {
    accessToken,
    params: { fields: 'id,display_phone_number,verified_name', limit: '100' },
  });
  const phone = (result.data || []).find((item) => item.id === phoneNumberId);
  if (!phone) throw new Error('The selected WhatsApp phone number is not part of this business account');
  return phone;
}

export async function subscribeWhatsappApp(wabaId, accessToken) {
  return graphRequest(`${wabaId}/subscribed_apps`, { method: 'POST', accessToken });
}

export async function registerWhatsappPhone(phoneNumberId, accessToken, pin) {
  phoneNumberIdSchema.parse(phoneNumberId);
  return graphRequest(`${phoneNumberId}/register`, {
    method: 'POST',
    accessToken,
    body: { messaging_product: 'whatsapp', pin },
  });
}

export async function unsubscribeWhatsappApp(wabaId, accessToken) {
  return graphRequest(`${wabaId}/subscribed_apps`, { method: 'DELETE', accessToken });
}