import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetAuditLog, mockToastError } = vi.hoisted(() => ({
  mockGetAuditLog: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('../../services/api', () => ({ adminAPI: { getAuditLog: mockGetAuditLog } }));
vi.mock('@/lib/toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: mockToastError }) }));
vi.mock('@/features/notifications/NotificationBell', () => ({ default: () => null }));

import AuditLog from '../AuditLog';

const entry = (n: number, over = {}) => ({
  id: `e-${n}`,
  action: 'staff.removed',
  summary: `Removed person ${n}`,
  actorEmail: 'owner@acme.test',
  actorRole: 'superAdmin',
  ipAddress: '203.0.113.7',
  createdAt: '2026-11-11T09:30:00.000Z',
  ...over,
});

const page = (rows: unknown[], nextCursor: string | null = null) => ({ status: 'success', data: rows, pagination: { limit: 50, nextCursor } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuditLog page', () => {
  it('lists each entry with what happened, who did it and from where', async () => {
    mockGetAuditLog.mockResolvedValue(page([entry(1)]));

    render(<AuditLog />);

    expect(await screen.findByText('Removed person 1')).toBeInTheDocument();
    expect(screen.getByText('owner@acme.test · Owner · 203.0.113.7')).toBeInTheDocument();
  });

  it('says so when nothing has been recorded', async () => {
    mockGetAuditLog.mockResolvedValue(page([]));

    render(<AuditLog />);

    expect(await screen.findByText('Nothing recorded yet.')).toBeInTheDocument();
  });

  it('asks the server for one group of actions when a filter is chosen', async () => {
    mockGetAuditLog.mockResolvedValue(page([]));
    render(<AuditLog />);
    await screen.findByText('Nothing recorded yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Bank details' }));

    await waitFor(() => expect(mockGetAuditLog).toHaveBeenLastCalledWith({ action: 'settings.bank_details_changed', cursor: undefined }));
    expect(screen.getByRole('button', { name: 'Bank details' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('appends the next page after the last entry when "Load more" is pressed', async () => {
    mockGetAuditLog
      .mockResolvedValueOnce(page([entry(1)], 'e-1'))
      .mockResolvedValueOnce(page([entry(2)]));
    render(<AuditLog />);
    await screen.findByText('Removed person 1');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Removed person 2')).toBeInTheDocument();
    expect(screen.getByText('Removed person 1')).toBeInTheDocument();
    expect(mockGetAuditLog).toHaveBeenLastCalledWith({ action: undefined, cursor: 'e-1' });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows an error instead of crashing when the log cannot be loaded', async () => {
    mockGetAuditLog.mockResolvedValue({ status: 'fail', message: "You don't have permission to do that." });

    render(<AuditLog />);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("You don't have permission to do that."));
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument();
  });

  it('shows "System" for an entry with no person behind it', async () => {
    mockGetAuditLog.mockResolvedValue(page([entry(1, { actorEmail: null, actorRole: null, ipAddress: null })]));

    render(<AuditLog />);

    expect(await screen.findByText('System')).toBeInTheDocument();
  });
});
