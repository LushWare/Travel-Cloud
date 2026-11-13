import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import { verifyWebhookSignature } from '../utils/webhookSignature.js';
import { mapGoogleAdsLead } from '../utils/googleAds.js';
import { submitGoogleAdsLead, logWhatsappCommunication } from '../services/lead.client.js';
import { verifyGoogleAdsWebhookKey } from '../services/integration.client.js';
import { z } from 'zod';

const tenantIdSchema = z.string().uuid();

export const handleGoogleAdsLeadWebhook = asyncHandler(async (req, res) => {
  const parsedTenantId = tenantIdSchema.safeParse(req.params?.tenantId);
  if (!parsedTenantId.success) throw new AppError('Invalid Google Ads webhook endpoint', 404);
  const tenantId = parsedTenantId.data;
  const receivedKey = req.body?.google_key;
  if (!tenantId || typeof receivedKey !== 'string' || !(await verifyGoogleAdsWebhookKey({ tenantId, googleKey: receivedKey }))) {
    throw new AppError('Invalid Google Ads webhook key', 401);
  }

  const lead = mapGoogleAdsLead(req.body);
  if (!lead.leadId || (!lead.email && !lead.phone)) {
    throw new AppError('Google Ads lead must include a lead ID and email or phone', 400);
  }

  const result = await submitGoogleAdsLead({ ...lead, tenantId });
  req.log?.info?.({ leadId: result?.data?.leadId, duplicate: result?.data?.duplicate, test: lead.isTest }, 'Google Ads lead processed');
  return res.status(200).json({ received: true });
});

export const verifyWhatsappWebhook = asyncHandler(async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!mode || !token) throw new AppError('Missing mode or token', 403);

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    req.log.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    throw new AppError('Verification failed', 403);
  }
});

export const handleWhatsappWebhook = asyncHandler(async (req, res) => {
  const signature = req.get('X-Hub-Signature-256');
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (signature && appSecret) {
    const valid = verifyWebhookSignature(signature, req.rawBody, appSecret);
    if (!valid) throw new AppError('Invalid webhook signature', 401);
  } else if (process.env.NODE_ENV === 'production') {
    throw new AppError('Webhook signature verification failed', 401);
  }

  const entry = req.body.entry;
  if (!Array.isArray(entry)) return res.status(200).json({ received: true });

  for (const entryItem of entry) {
    for (const change of entryItem.changes || []) {
      processWhatsappChange(change.value || {}).catch((e) =>
        req.log.error({ err: e }, 'WhatsApp webhook processing error')
      );
    }
  }

  res.status(200).json({ received: true });
});

// Inbound customer messages and outbound delivery-status callbacks both
// arrive as `entry[].changes[].value` — matched to a lead by phone number
// and appended to that lead's timeline. Fire-and-forget, same as Facebook's
// lead processing: Meta needs a fast 200, not a completed pipeline.
async function processWhatsappChange(value) {
  for (const message of value.messages || []) {
    const occurredAt = message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : undefined;
    const body = message.text?.body || `[${message.type} message]`;
    await logWhatsappCommunication({ phone: message.from, notes: `WhatsApp (customer): ${body}`, occurredAt });
  }

  for (const status of value.statuses || []) {
    const occurredAt = status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : undefined;
    await logWhatsappCommunication({
      phone: status.recipient_id,
      notes: `WhatsApp status: ${status.status}`,
      occurredAt,
    });
  }
}

