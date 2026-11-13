import { describe, expect, it, vi } from 'vitest';
import { requireAgencyAdmin } from '../middleware/admin.js';

function response() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe('agency integration permissions', () => {
  it('requires admin or owner access before exposing integration settings', () => {
    const res = response();
    const next = vi.fn();

    requireAgencyAdmin(
      { headers: { 'x-user-id': 'user-1', 'x-user-role': 'salesRep' }, tenantId: 'agency-1' },
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows an owner to manage agency integrations', () => {
    const res = response();
    const next = vi.fn();

    requireAgencyAdmin(
      {
        headers: { 'x-user-id': 'owner-1', 'x-user-role': 'salesRep', 'x-user-is-super-admin': 'true' },
        tenantId: 'agency-1',
      },
      res,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
