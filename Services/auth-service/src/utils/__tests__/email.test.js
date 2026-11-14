import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendViaNotificationService, mockLoggerError } = vi.hoisted(() => ({
  mockSendViaNotificationService: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../services/email.client.js', () => ({ sendEmail: mockSendViaNotificationService }));
vi.mock('../../config/logger.js', () => ({ default: { error: mockLoggerError, info: vi.fn(), warn: vi.fn() } }));

const {
  sendWelcomeEmail, sendEmailVerification, sendPasswordReset,
  sendPasswordChanged, sendOTPEmail, sendLoginNotification, sendAgencySignupCode,
} = await import('../email.js');

const USER = { name: 'Jane Doe', email: 'jane@test.com' };

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('auth-service email templates — structure', () => {
  beforeEach(() => {
    mockSendViaNotificationService.mockReset();
    mockLoggerError.mockReset();
    mockSendViaNotificationService.mockResolvedValue({ success: true });
  });

  it.each([
    ['sendWelcomeEmail', () => sendWelcomeEmail(USER)],
    ['sendEmailVerification', () => sendEmailVerification(USER, 'tok-1')],
    ['sendPasswordReset', () => sendPasswordReset(USER, 'tok-1')],
    ['sendAgencySignupCode', () => sendAgencySignupCode(USER, '123456')],
    ['sendPasswordChanged', () => sendPasswordChanged(USER)],
    ['sendOTPEmail', () => sendOTPEmail(USER, '123456')],
    ['sendLoginNotification', () => sendLoginNotification(USER)],
  ])('%s renders a full HTML document with a preheader and a non-empty text alternative', async (_name, call) => {
    await call();
    const args = mockSendViaNotificationService.mock.calls[0][0];
    expect(args.to).toBe(USER.email);
    expect(args.html).toContain('<!DOCTYPE html>');
    expect(args.html).toContain('mso-hide:all');
    expect(args.text.length).toBeGreaterThan(0);
  });

  it('escapes HTML-significant characters in the user name', async () => {
    await sendWelcomeEmail({ name: '<script>alert(1)</script>', email: 'x@test.com' });
    const args = mockSendViaNotificationService.mock.calls[0][0];
    expect(args.html).not.toContain('<script>alert(1)</script>');
    expect(args.html).toContain('&lt;script&gt;');
  });

  it('sendEmailVerification includes a button linking to CLIENT_URL/verify-email/:token', async () => {
    process.env.CLIENT_URL = 'https://app.lushtravelcloud.com';
    await sendEmailVerification(USER, 'tok-abc');
    const args = mockSendViaNotificationService.mock.calls[0][0];
    expect(args.html).toContain('https://app.lushtravelcloud.com/verify-email/tok-abc');
  });

  it('sendPasswordReset includes a button linking to CLIENT_URL/reset-password/:token', async () => {
    process.env.CLIENT_URL = 'https://app.lushtravelcloud.com';
    await sendPasswordReset(USER, 'tok-xyz');
    const args = mockSendViaNotificationService.mock.calls[0][0];
    expect(args.html).toContain('https://app.lushtravelcloud.com/reset-password/tok-xyz');
  });

  it('sendOTPEmail renders the code in a monospace block', async () => {
    await sendOTPEmail(USER, '654321');
    const args = mockSendViaNotificationService.mock.calls[0][0];
    expect(args.html).toContain('654321');
    expect(args.text).toContain('654321');
  });

  it('sends an agency signup code without including a verification link', async () => {
    await sendAgencySignupCode(USER, '654321');
    const args = mockSendViaNotificationService.mock.calls[0][0];
    expect(args.subject).toBe('Verify your agency account');
    expect(args.html).toContain('654321');
    expect(args.text).toContain('10 minutes');
    expect(args.html).not.toContain('verify-email');
  });
});

describe('auth-service email templates — failure semantics', () => {
  beforeEach(() => {
    mockSendViaNotificationService.mockReset();
    mockLoggerError.mockReset();
  });

  it.each([
    ['sendWelcomeEmail', () => sendWelcomeEmail(USER)],
    ['sendEmailVerification', () => sendEmailVerification(USER, 'tok-1')],
    ['sendPasswordChanged', () => sendPasswordChanged(USER)],
    ['sendLoginNotification', () => sendLoginNotification(USER)],
  ])('%s is fire-and-forget: swallows a send failure and logs it instead of rejecting', async (_name, call) => {
    mockSendViaNotificationService.mockRejectedValue(new Error('SMTP down'));
    await expect(call()).resolves.toBeUndefined();
    await flush();
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it.each([
    ['sendOTPEmail', () => sendOTPEmail(USER, '123456')],
    ['sendAgencySignupCode', () => sendAgencySignupCode(USER, '123456')],
    ['sendPasswordReset', () => sendPasswordReset(USER, 'tok-1')],
  ])('%s is blocking: propagates a send failure to the caller', async (_name, call) => {
    mockSendViaNotificationService.mockRejectedValue(new Error('SMTP down'));
    await expect(call()).rejects.toThrow('SMTP down');
  });
});
