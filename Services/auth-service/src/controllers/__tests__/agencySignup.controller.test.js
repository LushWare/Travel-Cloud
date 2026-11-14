import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signupService, userDb, email, limiter, completeLogin } = vi.hoisted(() => ({
  signupService: {
    createAgencySignup: vi.fn(),
    listSignupPlans: vi.fn(),
    resendAgencySignupCode: vi.fn(),
    verifyAgencySignup: vi.fn(),
  },
  userDb: { findUserById: vi.fn() },
  email: { sendAgencySignupCode: vi.fn() },
  limiter: { hit: vi.fn() },
  completeLogin: vi.fn(),
}));

vi.mock('../../services/agencySignup.service.js', () => signupService);
vi.mock('../../db/userQueries.js', () => userDb);
vi.mock('../../utils/email.js', () => email);
vi.mock('../../services/rateLimit.service.js', () => limiter);
vi.mock('../auth.controller.js', () => ({ completeLogin }));

import {
  getSignupPlans,
  registerAgency,
  resendAgencySignupCodeHandler,
  verifyAgencySignupCode,
} from '../agencySignup.controller.js';

async function call(handler, req = {}) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn(), cookie: vi.fn() };
  let error;
  await handler({
    body: {},
    headers: {},
    ip: '192.0.2.10',
    requestId: 'request-1',
    get: () => undefined,
    log: { error: vi.fn() },
    ...req,
  }, res, (caught) => { error = caught; });
  return { res, error, body: res.json.mock.calls[0]?.[0] };
}

beforeEach(() => {
  vi.clearAllMocks();
  limiter.hit.mockResolvedValue({ allowed: true, retryAfterSeconds: 1 });
  signupService.listSignupPlans.mockResolvedValue([{ key: 'growth', name: 'Growth' }]);
  signupService.createAgencySignup.mockResolvedValue({
    ownerName: 'Alex Owner', email: 'alex@example.com', code: '123456',
  });
  signupService.verifyAgencySignup.mockResolvedValue('owner-id');
  signupService.resendAgencySignupCode.mockResolvedValue({
    user: { name: 'Alex Owner', email: 'alex@example.com' }, code: '123456',
  });
  userDb.findUserById.mockResolvedValue({ id: 'owner-id', name: 'Alex Owner', email: 'alex@example.com', role: 'admin' });
  email.sendAgencySignupCode.mockResolvedValue();
});

describe('agency signup endpoints', () => {
  it('returns the public plan catalogue', async () => {
    const { body, error } = await call(getSignupPlans);

    expect(error).toBeUndefined();
    expect(body.data).toEqual([{ key: 'growth', name: 'Growth' }]);
  });

  it('normalizes the owner email and sends a verification code', async () => {
    const { res, body, error } = await call(registerAgency, {
      body: {
        agencyName: 'North Star Travel',
        ownerName: 'Alex Owner',
        email: 'Alex@Example.com',
        password: 'a secure password',
        planKey: 'growth',
      },
    });

    expect(error).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(signupService.createAgencySignup).toHaveBeenCalledWith(expect.objectContaining({
      email: 'alex@example.com',
      planKey: 'growth',
    }));
    expect(email.sendAgencySignupCode).toHaveBeenCalledWith(
      { name: 'Alex Owner', email: 'alex@example.com' },
      '123456',
    );
    expect(body.data.verificationRequired).toBe(true);
  });

  it('does not provision an agency for invalid signup data', async () => {
    const { error } = await call(registerAgency, {
      body: { agencyName: 'A', ownerName: '', email: 'not-an-email', password: 'short', planKey: 'internal' },
    });

    expect(error.statusCode).toBe(400);
    expect(signupService.createAgencySignup).not.toHaveBeenCalled();
  });

  it('verifies the code and signs the new owner into the agency', async () => {
    const { error } = await call(verifyAgencySignupCode, {
      body: { email: 'alex@example.com', code: '123456' },
    });

    expect(error).toBeUndefined();
    expect(signupService.verifyAgencySignup).toHaveBeenCalledWith({ email: 'alex@example.com', code: '123456' });
    expect(completeLogin).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ id: 'owner-id' }),
      200,
      'Email verified. Your agency is ready.',
    );
  });

  it('returns a generic resend response when no unfinished signup exists', async () => {
    signupService.resendAgencySignupCode.mockResolvedValue(null);

    const { body, error } = await call(resendAgencySignupCodeHandler, {
      body: { email: 'someone@example.com' },
    });

    expect(error).toBeUndefined();
    expect(body.message).toContain('If an unfinished signup exists');
    expect(email.sendAgencySignupCode).not.toHaveBeenCalled();
  });
});
