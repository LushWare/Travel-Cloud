import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendMail, mockCreateTransport } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockCreateTransport: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

const { sendEmail, isEmailConfigured } = await import('../email.js');

const ORIGINAL_ENV = { ...process.env };

function setSmtpEnv() {
  process.env.EMAIL_HOST = 'smtp.test.com';
  process.env.EMAIL_PORT = '587';
  process.env.EMAIL_SECURE = 'false';
  process.env.EMAIL_USER = 'sender@test.com';
  process.env.EMAIL_PASSWORD = 'app-password';
  process.env.EMAIL_FROM = 'noreply@test.com';
}

function clearSmtpEnv() {
  delete process.env.EMAIL_HOST;
  delete process.env.EMAIL_PORT;
  delete process.env.EMAIL_SECURE;
  delete process.env.EMAIL_USER;
  delete process.env.EMAIL_PASSWORD;
  delete process.env.EMAIL_FROM;
}

describe('isEmailConfigured', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    mockCreateTransport.mockReset();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
  });

  it('returns false when EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD are unset', () => {
    clearSmtpEnv();
    expect(isEmailConfigured()).toBe(false);
  });

  it('returns true when EMAIL_HOST, EMAIL_USER, and EMAIL_PASSWORD are all set', () => {
    setSmtpEnv();
    expect(isEmailConfigured()).toBe(true);
  });
});

describe('sendEmail', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    mockSendMail.mockReset();
    mockCreateTransport.mockReset();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
  });

  it('throws a 503 error when SMTP is not configured', async () => {
    clearSmtpEnv();

    // The reason a transport is missing is ours, not the caller's: the response
    // must not name SMTP or any environment variable.
    await expect(sendEmail({ to: 'a@test.com', subject: 'Hi', html: '<p>Hi</p>' }))
      .rejects.toMatchObject({
        statusCode: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        message: 'Email is temporarily unavailable. Please try again in a moment.',
      });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sends via the configured transport and returns the message id', async () => {
    setSmtpEnv();
    mockSendMail.mockResolvedValue({ messageId: 'msg-1' });

    const result = await sendEmail({ to: 'a@test.com', subject: 'Hi', html: '<p>Hi</p>' });

    expect(result).toEqual({ messageId: 'msg-1' });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'noreply@test.com', to: 'a@test.com', subject: 'Hi', html: '<p>Hi</p>',
    }));
  });

  it('always uses the platform sender and supports an agency reply-to', async () => {
    setSmtpEnv();
    mockSendMail.mockResolvedValue({ messageId: 'msg-2' });

    await sendEmail({
      to: 'a@test.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      from: 'Unverified <spoofed@outside.test>',
      replyTo: 'sales@agency.test',
    });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'noreply@test.com',
      replyTo: 'sales@agency.test',
    }));
  });

  it('decodes a base64 attachment into a Buffer before sending', async () => {
    setSmtpEnv();
    mockSendMail.mockResolvedValue({ messageId: 'msg-3' });
    const contentBase64 = Buffer.from('pdf-bytes').toString('base64');

    await sendEmail({
      to: 'a@test.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      attachments: [{ filename: 'doc.pdf', contentType: 'application/pdf', contentBase64 }],
    });

    const sentAttachments = mockSendMail.mock.calls[0][0].attachments;
    expect(sentAttachments).toHaveLength(1);
    expect(sentAttachments[0].filename).toBe('doc.pdf');
    expect(sentAttachments[0].content).toBeInstanceOf(Buffer);
    expect(sentAttachments[0].content.toString()).toBe('pdf-bytes');
  });

  it('rejects an attachment larger than the 10MB limit before contacting SMTP', async () => {
    setSmtpEnv();
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64');

    await expect(sendEmail({
      to: 'a@test.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      attachments: [{ filename: 'huge.pdf', contentType: 'application/pdf', contentBase64: oversized }],
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('propagates a nodemailer send failure', async () => {
    setSmtpEnv();
    mockSendMail.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(sendEmail({ to: 'a@test.com', subject: 'Hi', html: '<p>Hi</p>' }))
      .rejects.toThrow('ECONNREFUSED');
  });
});
