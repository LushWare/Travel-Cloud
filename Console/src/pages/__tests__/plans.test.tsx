import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Plans from '../Plans';

const admin = { id: 'p-1', email: 'ops@example.test', name: 'Ops', role: 'platform_admin' as const };
const plan = {
  id: '00000000-0000-4000-8000-000000000010', key: 'starter', archivedAt: null, createdAt: '2026-01-01',
  versions: [{
    id: '00000000-0000-4000-8000-000000000011', planId: '00000000-0000-4000-8000-000000000010', version: 1,
    name: 'Starter', description: null, priceMinorUnits: 1200, currency: 'USD', billingInterval: 'monthly',
    entitlements: { staff_seats: 3, packages: 10, features: { ai_itinerary_builder: true } },
    isCurrent: true, assignments: 2,
  }],
};
let fetchMock: ReturnType<typeof vi.fn>;

function response(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => ({ status: 'success', data }) };
}

function open() {
  return render(<Plans user={admin} onSignOut={vi.fn()} onChangePassword={vi.fn()} />);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Plans page', () => {
  it('lists the current version and assignment count', async () => {
    fetchMock = vi.fn().mockResolvedValue(response([plan]));
    vi.stubGlobal('fetch', fetchMock);
    open();

    expect(await screen.findByText('Starter')).toBeInTheDocument();
    expect(screen.getByText(/Version 1 · 2 agencies/)).toBeInTheDocument();
  });

  it('creates a plan with fixed supported entitlements', async () => {
    const user = userEvent.setup();
    fetchMock = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ id: plan.id }))
      .mockResolvedValueOnce(response([plan]));
    vi.stubGlobal('fetch', fetchMock);
    open();

    await user.click(await screen.findByRole('button', { name: /New plan/ }));
    await user.type(screen.getByLabelText('Plan key'), 'starter');
    await user.type(screen.getByLabelText('Plan name'), 'Starter');
    await user.click(screen.getByRole('button', { name: /Save plan/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      key: 'starter', name: 'Starter', entitlements: { staff_seats: null, packages: null },
    });
  });

  it('creates a new immutable version when editing an existing plan', async () => {
    const user = userEvent.setup();
    fetchMock = vi.fn()
      .mockResolvedValueOnce(response([plan]))
      .mockResolvedValueOnce(response({ version: 2 }))
      .mockResolvedValueOnce(response([plan]));
    vi.stubGlobal('fetch', fetchMock);
    open();

    await user.click(await screen.findByRole('button', { name: /Edit/ }));
    await user.clear(screen.getByLabelText('Plan name'));
    await user.type(screen.getByLabelText('Plan name'), 'Starter Plus');
    await user.click(screen.getByRole('button', { name: /Save plan/ }));

    await waitFor(() => expect(fetchMock.mock.calls[1][0]).toContain('/plans/00000000-0000-4000-8000-000000000010/versions'));
  });
});