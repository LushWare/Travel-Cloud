import { describe, it, expect, vi } from 'vitest';
import { extractUser, requireAuth, authorize } from '../auth.js';
import AppError from '../../utils/appError.js';

describe('extractUser', () => {
  it('sets req.user from gateway headers', () => {
    const req = {
      headers: {
        'x-user-id': 'user-123',
        'x-user-role': 'admin',
        'x-user-email': 'admin@test.com',
        'x-user-name': 'Test Admin',
        'x-user-permissions': '["manage_users"]',
        'x-user-is-super-admin': 'false',
      },
    };
    const next = vi.fn();

    extractUser(req, {}, next);

    expect(req.user).toEqual({
      id: 'user-123',
      role: 'admin',
      email: 'admin@test.com',
      name: 'Test Admin',
      permissions: ['manage_users'],
      isSuperAdmin: false,
      tenantId: null,
    });
    expect(next).toHaveBeenCalled();
  });

  it('reads the agency the gateway took from the login', () => {
    const req = { headers: { 'x-user-id': 'user-123', 'x-tenant-id': '11111111-1111-4111-8111-111111111111' } };

    extractUser(req, {}, vi.fn());

    expect(req.user.tenantId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('parses isSuperAdmin as boolean true', () => {
    const req = {
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'superAdmin',
        'x-user-is-super-admin': 'true',
        'x-user-permissions': '[]',
      },
    };
    const next = vi.fn();

    extractUser(req, {}, next);

    expect(req.user.isSuperAdmin).toBe(true);
  });

  it('does not set req.user when x-user-id is missing', () => {
    const req = { headers: {} };
    const next = vi.fn();

    extractUser(req, {}, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('defaults permissions to an empty array when the header is absent', () => {
    const req = { headers: { 'x-user-id': 'user-1', 'x-user-role': 'customer' } };
    const next = vi.fn();

    extractUser(req, {}, next);

    expect(req.user.permissions).toEqual([]);
  });
});

describe('requireAuth', () => {
  it('calls next() with no error when req.user exists', () => {
    const req = { user: { id: '1', role: 'admin' } };
    const next = vi.fn();

    requireAuth(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(AppError 401) when req.user is missing', () => {
    const req = {};
    const next = vi.fn();

    requireAuth(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });
});

describe('authorize', () => {
  it('allows a user with an allowed role', () => {
    const req = { user: { id: '1', role: 'admin', isSuperAdmin: false } };
    const next = vi.fn();

    authorize('admin', 'superAdmin')(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('blocks a user without an allowed role', () => {
    const req = { user: { id: '1', role: 'customer', isSuperAdmin: false } };
    const next = vi.fn();

    authorize('admin')(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('allows a superAdmin regardless of the allowed role list', () => {
    const req = { user: { id: '1', role: 'customer', isSuperAdmin: true } };
    const next = vi.fn();

    authorize('admin')(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('returns 401 when req.user is missing', () => {
    const req = {};
    const next = vi.fn();

    authorize('admin')(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });
});
