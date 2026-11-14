import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const {
  mockSendEmail,
  mockSendWhatsappTemplateMessage,
  mockSendWhatsappTextMessage,
  mockSendWithAgencyWhatsapp,
  mockGetTenantId,
} = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
  mockSendWhatsappTemplateMessage: vi.fn(),
  mockSendWhatsappTextMessage: vi.fn(),
  mockSendWithAgencyWhatsapp: vi.fn(),
  mockGetTenantId: vi.fn(),
}));

vi.mock('../../utils/email.js', () => ({
  sendEmail: mockSendEmail,
  isEmailConfigured: vi.fn(),
}));

vi.mock('../../utils/whatsapp.js', () => ({
  sendWhatsappTemplateMessage: mockSendWhatsappTemplateMessage,
  sendWhatsappTextMessage: mockSendWhatsappTextMessage,
  isWhatsappConfigured: vi.fn(),
}));

vi.mock('../../services/integration.client.js', () => ({
  sendWithAgencyWhatsapp: mockSendWithAgencyWhatsapp,
}));

vi.mock('../../../../shared/tenancy/src/context.js', () => ({ getTenantId: mockGetTenantId }));

const { default: notificationRoutes } = await import('../notification.routes.js');
const { default: errorHandler } = await import('../../middleware/errorHandler.js');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use((req, res, next) => {
    req.log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/v1/notifications', notificationRoutes);
  // The real handler, not a stand-in: these tests assert what a caller actually
  // receives, and a local stub would let a leak slip through unnoticed.
  app.use(errorHandler);
  return app;
}

const VALID_TOKEN = 'test-internal-token';
const PAYLOAD = { to: 'customer@test.com', subject: 'Hello', html: '<p>Hi</p>' };

describe('POST /api/v1/notifications/internal/email', () => {
  beforeEach(() => {
    mockSendEmail.mockReset();
    process.env.INTERNAL_EVENTS_TOKEN = VALID_TOKEN;
  });

  it('rejects the request when x-internal-token is missing', async () => {
    const res = await request(buildApp()).post('/api/v1/notifications/internal/email').send(PAYLOAD);

    expect(res.status).toBe(401);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects the request when x-internal-token is wrong', async () => {
    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/email')
      .set('x-internal-token', 'wrong-token')
      .send(PAYLOAD);

    expect(res.status).toBe(401);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects a payload missing the required "to" field', async () => {
    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/email')
      .set('x-internal-token', VALID_TOKEN)
      .send({ subject: 'Hello', html: '<p>Hi</p>' });

    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('sends the email and returns the message id on success', async () => {
    mockSendEmail.mockResolvedValue({ messageId: 'msg-123' });

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/email')
      .set('x-internal-token', VALID_TOKEN)
      .send({ ...PAYLOAD, replyTo: 'sales@agency.test', from: 'spoofed@outside.test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { messageId: 'msg-123' } });
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'customer@test.com', subject: 'Hello', html: '<p>Hi</p>', replyTo: 'sales@agency.test',
    }));
    expect(mockSendEmail.mock.calls[0][0]).not.toHaveProperty('from');
  });

  it('rejects an invalid reply-to address', async () => {
    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/email')
      .set('x-internal-token', VALID_TOKEN)
      .send({ ...PAYLOAD, replyTo: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 503 when SMTP is not configured', async () => {
    const err = new Error('Email is not configured');
    err.statusCode = 503;
    mockSendEmail.mockRejectedValue(err);

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/email')
      .set('x-internal-token', VALID_TOKEN)
      .send(PAYLOAD);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('returns 502 with a generic message when the SMTP send fails', async () => {
    mockSendEmail.mockRejectedValue(new Error('ECONNREFUSED: connection refused'));

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/email')
      .set('x-internal-token', VALID_TOKEN)
      .send(PAYLOAD);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      success: false,
      status: 'error',
      code: 'DEPENDENCY_UNAVAILABLE',
      message: "We couldn't send that email. Please try again.",
    });
    // The transport's own text is logged server-side and never returned.
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it('forwards a base64 PDF attachment to the transport layer', async () => {
    mockSendEmail.mockResolvedValue({ messageId: 'msg-456' });
    const attachments = [{ filename: 'quotation.pdf', contentType: 'application/pdf', contentBase64: Buffer.from('pdf-bytes').toString('base64') }];

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/email')
      .set('x-internal-token', VALID_TOKEN)
      .send({ ...PAYLOAD, attachments });

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ attachments }));
  });
});

describe('POST /api/v1/notifications/internal/whatsapp', () => {
  beforeEach(() => {
    mockSendWhatsappTemplateMessage.mockReset();
    mockSendWhatsappTextMessage.mockReset();
    mockSendWithAgencyWhatsapp.mockReset().mockResolvedValue(null);
    mockGetTenantId.mockReset().mockReturnValue('11111111-1111-4111-8111-111111111111');
    process.env.INTERNAL_EVENTS_TOKEN = VALID_TOKEN;
    process.env.WHATSAPP_LEGACY_TENANT_ID = '11111111-1111-4111-8111-111111111111';
  });

  const TEMPLATE_PAYLOAD = {
    type: 'template',
    to: '+15551234567',
    templateName: 'quotation_ready',
    languageCode: 'en_US',
    headerDocument: { link: 'https://cdn.test/q.pdf', filename: 'quotation-Q1.pdf' },
    bodyParams: ['Jane', 'Q-1'],
  };

  it('rejects the request when x-internal-token is missing', async () => {
    const res = await request(buildApp()).post('/api/v1/notifications/internal/whatsapp').send(TEMPLATE_PAYLOAD);

    expect(res.status).toBe(401);
    expect(mockSendWhatsappTemplateMessage).not.toHaveBeenCalled();
  });

  it('rejects a payload missing the required "templateName" field', async () => {
    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/whatsapp')
      .set('x-internal-token', VALID_TOKEN)
      .send({ type: 'template', to: '+15551234567' });

    expect(res.status).toBe(400);
    expect(mockSendWhatsappTemplateMessage).not.toHaveBeenCalled();
  });

  it('sends a template message and returns the Graph API result on success', async () => {
    mockSendWhatsappTemplateMessage.mockResolvedValue({ messages: [{ id: 'wamid.123' }] });

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/whatsapp')
      .set('x-internal-token', VALID_TOKEN)
      .send(TEMPLATE_PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { messages: [{ id: 'wamid.123' }] } });
    expect(mockSendWhatsappTemplateMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: '+15551234567', templateName: 'quotation_ready',
    }));
  });

  it('sends a free-form text message via the text path', async () => {
    mockSendWhatsappTextMessage.mockResolvedValue({ messages: [{ id: 'wamid.456' }] });

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/whatsapp')
      .set('x-internal-token', VALID_TOKEN)
      .send({ type: 'text', to: '+15551234567', body: 'Thanks for reaching out!' });

    expect(res.status).toBe(200);
    expect(mockSendWhatsappTextMessage).toHaveBeenCalledWith(expect.objectContaining({ body: 'Thanks for reaching out!' }));
  });

  it('returns 503 when WhatsApp is not configured', async () => {
    const err = new Error('WhatsApp is not configured');
    err.statusCode = 503;
    mockSendWhatsappTemplateMessage.mockRejectedValue(err);

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/whatsapp')
      .set('x-internal-token', VALID_TOKEN)
      .send(TEMPLATE_PAYLOAD);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it('returns 502 with a generic message when the Graph API send fails unexpectedly', async () => {
    const err = new Error('socket hang up');
    err.statusCode = 502;
    mockSendWhatsappTemplateMessage.mockRejectedValue(err);

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/whatsapp')
      .set('x-internal-token', VALID_TOKEN)
      .send(TEMPLATE_PAYLOAD);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({
      success: false,
      status: 'error',
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'WhatsApp messaging is temporarily unavailable. Please try again in a moment.',
    });
    expect(JSON.stringify(res.body)).not.toContain('socket hang up');
  });

  it('does not use legacy global credentials for another agency', async () => {
    mockGetTenantId.mockReturnValue('22222222-2222-4222-8222-222222222222');

    const res = await request(buildApp())
      .post('/api/v1/notifications/internal/whatsapp')
      .set('x-internal-token', VALID_TOKEN)
      .send(TEMPLATE_PAYLOAD);

    expect(res.status).toBe(503);
    expect(mockSendWhatsappTemplateMessage).not.toHaveBeenCalled();
    expect(mockSendWhatsappTextMessage).not.toHaveBeenCalled();
  });
});
