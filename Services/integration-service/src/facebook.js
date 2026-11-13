import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const META_API = 'https://graph.facebook.com';
const META_DIALOG_API = 'https://www.facebook.com';
const FACEBOOK_SCOPES = [
  'ads_management',
  'leads_retrieval',
  'pages_manage_ads',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
].join(',');
const oauthStateSchema = z.object({
  tenantId: z.string().uuid(),
  nonce: z.string().min(32).max(128),
  expiresAt: z.number().int().positive(),
});
const pageSchema = z.object({
  id: z.string().regex(/^\d{1,30}$/),
  name: z.string().min(1).max(200),
  access_token: z.string().min(1).max(8192),
});

export class FacebookApiError extends Error {
  constructor(status, code) {
    super(`Meta Graph API request failed with status ${status}`);
    this.name = 'FacebookApiError';
    this.status = status;
    this.providerCode = code || null;
  }
}

export function facebookAppConfig() {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Facebook integration is not configured');
  return { appId, appSecret };
}

function graphVersion() {
  const version = process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('Facebook Graph API version is invalid');
  return version;
}

function publicApiBaseUrl() {
  const value = process.env.PUBLIC_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  if (!value) throw new Error('Public API URL is not configured');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Public API URL must use HTTP or HTTPS');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Public API URL must use HTTPS in production');
  }
  return url.toString().replace(/\/+$/, '');
}

export function facebookOAuthCallbackUrl() {
  return `${publicApiBaseUrl()}/api/v1/integrations/facebook/callback`;
}

export function facebookWebhookUrl() {
  return `${publicApiBaseUrl()}/api/v1/webhooks/facebook`;
}

export function createFacebookOAuthState(tenantId, expiresAt = Date.now() + 10 * 60 * 1000) {
  const { appSecret } = facebookAppConfig();
  const claims = {
    tenantId,
    nonce: randomBytes(32).toString('base64url'),
    expiresAt,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', appSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyFacebookOAuthState(state) {
  if (typeof state !== 'string' || state.length > 2048) return null;
  const [payload, receivedSignature, extra] = state.split('.');
  if (!payload || !receivedSignature || extra !== undefined) return null;
  const { appSecret } = facebookAppConfig();
  const expected = createHmac('sha256', appSecret).update(payload).digest();
  let received;
  try {
    received = Buffer.from(receivedSignature, 'base64url');
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const claims = oauthStateSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (claims.expiresAt <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function facebookAuthorizationUrl(state) {
  const { appId } = facebookAppConfig();
  const url = new URL(`${META_DIALOG_API}/${graphVersion()}/dialog/oauth`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', facebookOAuthCallbackUrl());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', FACEBOOK_SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

async function graphRequest(path, { method = 'GET', params = new URLSearchParams() } = {}) {
  const url = new URL(`${META_API}/${graphVersion()}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of params) url.searchParams.set(key, value);
  const response = await fetch(url, { method, signal: AbortSignal.timeout(10_000) });
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || data?.error) {
    throw new FacebookApiError(response.status, data?.error?.code);
  }
  return data;
}

export async function exchangeFacebookCode(code) {
  const { appId, appSecret } = facebookAppConfig();
  const initialParams = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: facebookOAuthCallbackUrl(),
    code,
  });
  const shortLived = await graphRequest('oauth/access_token', { params: initialParams });
  if (typeof shortLived.access_token !== 'string' || !shortLived.access_token) {
    throw new Error('Meta did not return an access token');
  }
  const longLivedParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLived.access_token,
  });
  const longLived = await graphRequest('oauth/access_token', { params: longLivedParams });
  if (typeof longLived.access_token !== 'string' || !longLived.access_token) {
    throw new Error('Meta did not return a long-lived access token');
  }
  return longLived.access_token;
}

export async function listFacebookPages(userAccessToken) {
  const params = new URLSearchParams({
    fields: 'id,name,access_token',
    limit: '100',
    access_token: userAccessToken,
  });
  const pages = [];
  let nextUrl = new URL(`${META_API}/${graphVersion()}/me/accounts?${params}`);
  for (let pageNumber = 0; nextUrl && pageNumber < 20; pageNumber += 1) {
    const response = await fetch(nextUrl, { signal: AbortSignal.timeout(10_000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) throw new FacebookApiError(response.status, data?.error?.code);
    for (const page of data.data || []) {
      const parsed = pageSchema.safeParse(page);
      if (parsed.success) pages.push({
        id: parsed.data.id,
        name: parsed.data.name,
        accessToken: parsed.data.access_token,
      });
    }
    const candidate = data.paging?.next;
    if (!candidate) break;
    const parsedNext = new URL(candidate);
    if (parsedNext.origin !== META_API) throw new Error('Meta returned an invalid pagination URL');
    nextUrl = parsedNext;
  }
  return pages;
}

export async function subscribeFacebookPage(pageId, accessToken) {
  const params = new URLSearchParams({ subscribed_fields: 'leadgen', access_token: accessToken });
  const result = await graphRequest(`${encodeURIComponent(pageId)}/subscribed_apps`, { method: 'POST', params });
  if (result.success !== true && result.success !== 'true') {
    throw new Error('Meta did not confirm the page subscription');
  }
}

export async function unsubscribeFacebookPage(pageId, accessToken) {
  const params = new URLSearchParams({ subscribed_fields: 'leadgen', access_token: accessToken });
  const result = await graphRequest(`${encodeURIComponent(pageId)}/subscribed_apps`, { method: 'DELETE', params });
  if (result.success !== true && result.success !== 'true') {
    throw new Error('Meta did not confirm the page unsubscribe');
  }
}

export async function getFacebookLead(leadgenId, accessToken) {
  const params = new URLSearchParams({ fields: 'field_data,platform', access_token: accessToken });
  return graphRequest(encodeURIComponent(leadgenId), { params });
}

export function mapFacebookLeadToLead(facebookData, platformHint) {
  const platform = String(platformHint || facebookData.platform || '').toLowerCase();
  const isInstagram = ['instagram', 'ig'].includes(platform);
  const source = isInstagram ? 'instagram' : 'facebook';
  const fields = {};
  for (const field of facebookData.field_data || []) {
    if (typeof field?.name === 'string') {
      fields[field.name.toLowerCase()] = field.values?.[0] || '';
    }
  }
  return {
    name: fields.full_name || fields.name || '',
    email: fields.email || '',
    phone: fields.phone_number || fields.phone || '',
    source,
    message: fields.comments || fields.message || '',
  };
}
