import { describe, it, expect, vi } from 'vitest';

// Plan checks are covered in plan.service.test.js; here every agency has every module.
vi.mock('../plan.service.js', () => ({ assertPlanFeature: vi.fn().mockResolvedValue(undefined), metered: vi.fn((_metric, send) => send()) }));
import { sendWhatsappTemplate } from '../whatsapp.client.js';
import { assertPlanFeature } from '../plan.service.js';
import AppError from '../../utils/appError.js';

describe('whatsapp.client sendWhatsappTemplate', () => {
  it('never calls notification-service when the plan leaves WhatsApp out', async () => {
    vi.mocked(assertPlanFeature).mockRejectedValueOnce(new AppError('not in plan', 403, { code: 'FEATURE_NOT_IN_PLAN' }));
    const fetchImpl = vi.fn();

    await expect(sendWhatsappTemplate({ to: '+15551234567', templateName: 'invoice_ready', fetchImpl }))
      .rejects.toMatchObject({ code: 'FEATURE_NOT_IN_PLAN' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs a template payload to notification-service with the internal token header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { messages: [{ id: 'wamid.1' }] } }) });

    const result = await sendWhatsappTemplate({
      to: '+15551234567',
      templateName: 'quotation_ready',
      languageCode: 'en_US',
      headerDocumentUrl: 'https://cdn.test/q.pdf',
      headerDocumentFilename: 'quotation-Q1.pdf',
      bodyParams: ['Jane', 'Q-1'],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/v1/notifications/internal/whatsapp');
    expect(options.method).toBe('POST');
    expect(options.headers['x-internal-token']).toBeTypeOf('string');

    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      type: 'template',
      to: '+15551234567',
      templateName: 'quotation_ready',
      headerDocument: { link: 'https://cdn.test/q.pdf', filename: 'quotation-Q1.pdf' },
      bodyParams: ['Jane', 'Q-1'],
    });
    expect(result).toEqual({ success: true, data: { messages: [{ id: 'wamid.1' }] } });
  });

  it('omits headerDocument when no mediaUrl is given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

    await sendWhatsappTemplate({ to: '+15551234567', templateName: 'quotation_ready', bodyParams: [], fetchImpl });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.headerDocument).toBeUndefined();
  });

  it('throws with the notification-service error message when the call fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: 'WhatsApp is not configured' }) });

    await expect(
      sendWhatsappTemplate({ to: '+15551234567', templateName: 'quotation_ready', bodyParams: [], fetchImpl })
    ).rejects.toThrow('WhatsApp is not configured');
  });
});
