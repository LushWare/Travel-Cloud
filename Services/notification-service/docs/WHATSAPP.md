# WhatsApp (Meta Cloud API)

**Service:** `@travel-crm/notification-service` (Port 3008)
**Provider:** Meta WhatsApp Cloud API (Graph API) — no SDK, plain `fetch`
**Status:** Code complete, credentials not yet provisioned (`isWhatsappConfigured()` is `false` until `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` are set)

notification-service is the **only** service holding Meta credentials, exactly like it's the only service holding SMTP credentials for email. Every other service reaches WhatsApp through this service's internal HTTP API — none of them talk to `graph.facebook.com` directly.

This replaces a previous Twilio-shaped integration that lived in `billing-service` and was permanently mocked (`TWILIO_MOCK_MODE=true`) — nothing was ever actually sent through it.

---

## 1. Architecture

```
billing-service (quotation/invoice/receipt/voucher "send" buttons)
     │ POST /notifications/internal/whatsapp  (x-internal-token)
     ▼
notification-service ──▶ graph.facebook.com  (Meta Cloud API)
     │
     ▼ (after a successful send)
lead-service            POST /leads/internal/communication-logs

Meta ──▶ POST /webhooks/whatsapp (public, signature-verified) ──▶ notification-service
                                                                        │
                                                                        ▼
                                                     lead-service   POST /leads/internal/communication-logs
                                                     (phone-matched to a lead)

Management (agent reply / view history)
     │ JWT
     ▼
lead-service  POST /leads/:id/whatsapp-reply
     │ x-internal-token
     ▼
notification-service ──▶ graph.facebook.com
```

- **notification-service** — holds Meta credentials, does the actual Graph API calls, receives Meta's webhook.
- **billing-service** — keeps all templating/branding logic (what to say), delegates delivery.
- **lead-service** — owns the `LeadCommunicationLog` table, the durable "WhatsApp thread" per lead shown in Management.
- **Management** — reads the lead's communication log via the existing `GET /leads/:id` response and can send a free-form reply within a live session.

---

## 2. Outbound sending

### Endpoint

`POST /api/v1/notifications/internal/whatsapp` — internal, `x-internal-token` gated (same `internalTokenAuth` middleware and `INTERNAL_EVENTS_TOKEN` env var as `/internal/email`).

Two payload shapes (`src/validators/whatsapp.validator.js`), picked by `type`:

**`type: "template"`** — the only way to reach a customer **outside** a live 24h session. Used for all four billing documents.
```json
{
  "type": "template",
  "to": "+15551234567",
  "templateName": "quotation_ready",
  "languageCode": "en_US",
  "headerDocument": { "link": "https://res.cloudinary.com/.../quotation.pdf", "filename": "quotation-QT-1.pdf" },
  "bodyParams": ["Jane", "Acme Travel", "QT-1", "$1,200.00", "9/1/2026"]
}
```

**`type: "text"`** — free-form, only accepted by Meta within 24h of the customer's last inbound message. Used for agent replies from the CRM.
```json
{ "type": "text", "to": "+15551234567", "body": "Thanks for reaching out!" }
```

### Where each type is built

- `Services/billing-service/src/utils/whatsappService.js` — `sendQuotationWhatsapp` / `sendInvoiceWhatsapp` / `sendReceiptWhatsapp` / `sendVoucherWhatsapp`. Same function signatures as the old Twilio version, so the four controllers (`quotation.controller.js` etc.) didn't need to change. Builds the `bodyParams` array from the document + live org branding, and points `headerDocument.link` at the Cloudinary-hosted PDF (`uploadPdfBuffer`, unchanged).
- `Services/lead-service/src/controllers/lead.controller.js` — `sendWhatsappReply` builds the `text` payload for an agent's free-form reply.
- `Services/notification-service/src/utils/whatsapp.js` — `sendWhatsappTemplateMessage` / `sendWhatsappTextMessage` turn either shape into the actual Graph API call: `POST https://graph.facebook.com/{WHATSAPP_API_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages`.

### Why templates for the documents

Meta requires every **business-initiated** message (i.e. not a reply inside a live customer session) to use a template pre-approved by Meta. A quotation/invoice/receipt/voucher notification is always business-initiated — the customer didn't just message asking for it — so free text is not an option there. See §5 for what templates need to exist.

### Template ↔ document mapping

Names are plain constants in `whatsappService.js` (not secrets — templates are public once approved), overridable via env if your approved names differ:

| Document | Env override | Default template name |
|---|---|---|
| Quotation | `WHATSAPP_TEMPLATE_QUOTATION` | `quotation_ready` |
| Invoice | `WHATSAPP_TEMPLATE_INVOICE` | `invoice_ready` |
| Payment receipt | `WHATSAPP_TEMPLATE_RECEIPT` | `payment_receipt_ready` |
| Voucher | `WHATSAPP_TEMPLATE_VOUCHER` | `travel_voucher_ready` |

`WHATSAPP_TEMPLATE_LANGUAGE` (default `en_US`) applies to all four.

---

## 3. Inbound webhook

`GET/POST /api/v1/webhooks/whatsapp` — public at the Gateway (already covered by its blanket `/api/v1/webhooks/*` public-route pattern; no Gateway change was needed).

- **`GET`** (`verifyWhatsappWebhook`) — Meta's one-time subscription handshake: checks `hub.mode === 'subscribe' && hub.verify_token === WHATSAPP_VERIFY_TOKEN`, echoes `hub.challenge`.
- **`POST`** (`handleWhatsappWebhook`) — every inbound message and delivery-status callback:
  1. Verifies `X-Hub-Signature-256` (HMAC-SHA256 over the **raw** request body, keyed with `WHATSAPP_APP_SECRET`), constant-time compared — see §4.
  2. Responds `200` immediately (Meta expects a fast ack).
  3. Fire-and-forget processes `entry[].changes[].value`:
     - `messages[]` → inbound customer text → logged as `WhatsApp (customer): <body>`.
     - `statuses[]` → delivery/read/failed callback → logged as `WhatsApp status: <status>`.
     Both are matched to a lead by phone number via `POST /leads/internal/communication-logs` (`src/services/lead.client.js`, `logWhatsappCommunication`). An unrecognized number is **not** an error — it's logged as `{ matched: false }` and dropped, not turned into a new lead.

Meta webhooks use the same `hub.*` handshake and signature scheme. Facebook Lead Ads callbacks are handled by integration-service so each agency's page token stays tenant-scoped; WhatsApp callbacks remain in notification-service.

---

## 4. Security

- **Token type:** `WHATSAPP_ACCESS_TOKEN` must be a Meta **system-user permanent token**, scoped to `whatsapp_business_messaging` + `whatsapp_business_management` only — not a personal/temporary token (those expire in ~24h). Never exposed outside notification-service; Management never talks to Meta directly.
- **Signature verification:** `src/utils/webhookSignature.js` — shared by both the Facebook and WhatsApp webhooks. HMAC-SHA256 over the **raw request bytes** (captured via `express.json({ verify })` in `src/index.js`, not a re-serialized `JSON.stringify(req.body)` — those can silently drift from what Meta actually signed), compared with `crypto.timingSafeEqual` (constant-time, not `===`).
- **Two distinct secrets:** `WHATSAPP_APP_SECRET` (signs webhook payloads) and `WHATSAPP_VERIFY_TOKEN` (one-time subscribe handshake) are never the same value.
- **Fail-closed in production:** an unsigned or invalid webhook request is rejected with `401`. Permissive only when `NODE_ENV !== 'production'` and no signature/secret is configured (local dev without a tunnel).
- **PII in logs:** phone numbers are masked (`maskPhone`, `notification.controller.js`) before logging; full message bodies are never logged, only lengths/types.
- **Session window enforcement:** free-form replies are only attempted when the UI shows a live session (last inbound message within 24h); Meta's API is the authoritative enforcement regardless.

---

## 5. One-time setup (Meta Business Manager)

Required before anything here can send a real message:

1. Create a Meta App (Business type) → add the **WhatsApp** product.
2. **Business Settings → System users** → create one, generate a **permanent access token** scoped to `whatsapp_business_messaging` + `whatsapp_business_management`.
3. Note the **Phone Number ID** and **WhatsApp Business Account ID** (Graph API internal IDs, not the visible phone number).
4. Generate an **App Secret** and pick a **Verify Token** (two different values).
5. Once this service is deployed at a public HTTPS URL, register `https://<host>/api/v1/webhooks/whatsapp` in the App's WhatsApp → Configuration → Webhook settings, subscribe to the `messages` field.
6. Create and submit for approval **4 templates**, category `UTILITY`, each with a **Document** header (so the PDF attaches) and a body matching the table below. Approval can take hours to days — start this independently of any deploy.

| Template | Body |
|---|---|
| `quotation_ready` | Hi {{1}}, your {{2}} quotation {{3}} is ready. Total: {{4}}. Valid until: {{5}}. |
| `invoice_ready` | Hi {{1}}, your {{2}} invoice {{3}} is ready. Total: {{4}}. Due date: {{5}}. |
| `payment_receipt_ready` | Hi {{1}}, your {{2}} payment receipt {{3}} is ready. Amount received: {{4}}. Against invoice: {{5}}. |
| `travel_voucher_ready` | Hi {{1}}, your {{2}} travel voucher {{3}} is ready. Travel dates: {{4}}. |

---

## 6. Environment variables

All in `Services/notification-service/.env` (see `.env.example`):

```
WHATSAPP_ACCESS_TOKEN=          # system-user permanent token
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_APP_SECRET=            # signs inbound webhooks
WHATSAPP_VERIFY_TOKEN=          # webhook subscribe handshake — distinct from APP_SECRET
WHATSAPP_API_VERSION=v23.0
```

`billing-service` and `lead-service` need `NOTIFICATION_SERVICE_URL` + `INTERNAL_EVENTS_TOKEN` (matching notification-service's own `INTERNAL_EVENTS_TOKEN`) to call in — see their own `.env.example` files.

---

## 7. What's in the CRM

`LeadCommunicationLog` (lead-service, `crm_leads` schema) gained a `whatsapp` enum value (migration `20260822140000_add_whatsapp_communication_log_type` — additive-only, needs `db:migrate:deploy` to reach the shared DB). Direction/kind is encoded as a prefix on the note text rather than a separate column:

- `WhatsApp: <doc> sent` — a document was sent (billing-service)
- `WhatsApp (customer): <text>` — inbound message
- `WhatsApp (agent): <text>` — an agent's free-form reply
- `WhatsApp status: <status>` — delivery/read/failed callback

Management's WhatsApp dialog (`WhatsAppHistoryDialog.jsx`) reads and renders these off the existing `GET /leads/:id` response — no dedicated read endpoint was added.

---

## 8. Explicitly out of scope

- Auto-creating a lead from an inbound message on an unrecognized number.
- Pre-uploading PDFs via Meta's Media API (`media_id`) instead of a public Cloudinary `link` — fine for one-off document sends, revisit only if repeated resends of the same file become common.
- Programmatic template creation via Meta's API — templates are created/approved manually (§5).
- Marketing/broadcast messages, opt-in/opt-out list management — only `UTILITY` transactional sends and session replies are supported.
