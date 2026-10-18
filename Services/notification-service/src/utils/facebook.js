import { verifyWebhookSignature } from './webhookSignature.js';

export { verifyWebhookSignature };

const GRAPH_API_VERSION = process.env.FACEBOOK_GRAPH_API_VERSION || 'v23.0';

export async function getLeadData(leadgenId, accessToken) {
  const query = new URLSearchParams({ fields: 'field_data,platform', access_token: accessToken });
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(leadgenId)}?${query}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const apiError = data?.error;
    const details = apiError?.message || 'Unknown Graph API error';
    const code = apiError?.code ? ` (${apiError.code})` : '';
    throw new Error(`Facebook API error: ${res.status}${code}: ${details}`);
  }
  return data;
}

export function mapFacebookLeadToLead(fbData, platformHint) {
  const platform = String(platformHint || fbData.platform || '').toLowerCase();
  const isInstagram = ['instagram', 'ig'].includes(platform);
  const source = isInstagram ? 'instagram' : 'facebook';
  const fields = {};
  for (const f of fbData.field_data || []) {
    fields[f.name.toLowerCase()] = f.values?.[0] || '';
  }
  return {
    name: fields.full_name || fields.name || '',
    email: fields.email || '',
    phone: fields.phone_number || fields.phone || '',
    source,
    platform: isInstagram ? 'Instagram' : 'Facebook',
    message: fields.comments || fields.message || '',
    tags: [`${source}-lead`],
    leadDateTime: new Date(),
    status: 'new',
  };
}
