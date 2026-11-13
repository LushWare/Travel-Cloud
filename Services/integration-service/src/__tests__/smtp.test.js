import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup, createTransport, verify, close } = vi.hoisted(() => ({
  lookup: vi.fn(),
  createTransport: vi.fn(),
  verify: vi.fn(),
  close: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({ default: { lookup } }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const { resolveSmtpHost, smtpSchema, verifySmtp } = await import('../smtp.js');

describe('SMTP destination safety', () => {
  beforeEach(() => {
    lookup.mockReset();
    createTransport.mockReset();
    verify.mockReset();
    close.mockReset();
    createTransport.mockReturnValue({ verify, close });
  });

  it('rejects SMTP destinations resolving to private addresses', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(resolveSmtpHost('mail.example.com')).rejects.toThrow('not allowed');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('pins the SMTP connection to a validated public IP', async () => {
    lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    verify.mockResolvedValue(undefined);

    await verifySmtp({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'sales@example.com',
      password: 'private',
      from: 'sales@example.com',
    });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: '8.8.8.8',
      tls: { servername: 'smtp.example.com', rejectUnauthorized: true },
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('requires direct TLS only for port 465', () => {
    const result = smtpSchema.safeParse({
      host: 'smtp.example.com',
      port: 465,
      secure: false,
      username: 'sales@example.com',
      password: 'private',
      from: 'sales@example.com',
    });

    expect(result.success).toBe(false);
  });
});
