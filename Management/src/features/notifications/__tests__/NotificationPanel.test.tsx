import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockNavigate, mockUseNotifications } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseNotifications: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../NotificationProvider', () => ({ useNotifications: mockUseNotifications }));

import { Popover } from '@/components/ui/popover';
import NotificationPanel from '../NotificationPanel';
import type { BusinessNotification } from '../types';

// NotificationPanel renders PopoverContent, which requires the popover root the
// bell provides in the app — so the harness supplies the same root.
const renderPanel = (onClose = vi.fn()) =>
  render(
    <Popover open>
      <NotificationPanel open onClose={onClose} />
    </Popover>,
  );

const notification = (overrides: Partial<BusinessNotification> = {}): BusinessNotification => ({
  id: 'quotes.unconverted_value',
  key: 'quotes.unconverted_value',
  category: 'revenue',
  severity: 'critical',
  section: 'attention',
  text: '8 quotes worth $24,000 remain unconverted from the last 30 days.',
  facts: [{ kind: 'count', value: '8', evidenceId: 'business:quotes.unconverted_value:count' }],
  materialValue: '8:24000',
  target: { path: '/billing', query: { tab: 'quotation', ids: 'quote-1,quote-2' }, label: 'View quotes' },
  firstSeenAt: '2026-09-14T08:00:00.000Z',
  unread: true,
  ...overrides,
});

const session = (notifications: BusinessNotification[]) => ({
  notifications,
  unreadCounts: { critical: 0, warning: 0, info: 0 },
  canView: true,
  scope: 'org' as const,
  currency: 'USD',
  loading: false,
  error: null,
  lastLoadedAt: Date.now(),
  unavailableSignals: [],
  refresh: vi.fn(),
  markRead: vi.fn(),
  acknowledge: vi.fn(),
  dismiss: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationPanel', () => {
  it('renders warnings and criticals immediately and folds the info tier away', async () => {
    mockUseNotifications.mockReturnValue(session([
      notification(),
      notification({ id: 'packages.silent_active', key: 'packages.silent_active', severity: 'info', category: 'customer', text: '12 active packages have had no inquiries.' }),
    ]));

    renderPanel();

    expect(screen.getByText(/8 quotes worth/)).toBeInTheDocument();
    expect(screen.queryByText(/12 active packages/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Also worth a look \(1\)/ })).toBeInTheDocument();
  });

  it('reveals the folded tier when its disclosure is activated', async () => {
    mockUseNotifications.mockReturnValue(session([
      notification({ id: 'packages.silent_active', key: 'packages.silent_active', severity: 'info', category: 'customer', text: '12 active packages have had no inquiries.' }),
    ]));

    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /Also worth a look/ }));

    expect(screen.getByText(/12 active packages/)).toBeInTheDocument();
  });

  it('navigates to the target URL and acknowledges the notification on View', async () => {
    const active = session([notification()]);
    mockUseNotifications.mockReturnValue(active);
    const onClose = vi.fn();

    renderPanel(onClose);
    await userEvent.click(screen.getByRole('button', { name: 'View quotes' }));

    expect(active.acknowledge).toHaveBeenCalledWith(expect.objectContaining({ key: 'quotes.unconverted_value' }));
    expect(mockNavigate).toHaveBeenCalledWith('/billing?tab=quotation&ids=quote-1%2Cquote-2');
    expect(onClose).toHaveBeenCalled();
  });

  it('marks the visible unread notifications read once the panel is open', async () => {
    const active = session([notification()]);
    mockUseNotifications.mockReturnValue(active);

    renderPanel();

    await waitFor(() => expect(active.markRead).toHaveBeenCalledWith(['quotes.unconverted_value']));
  });

  it('renders business facts without chat controls', () => {
    mockUseNotifications.mockReturnValue(session([notification()]));
    renderPanel();

    expect(screen.getByText('count:')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /chat about this/i })).not.toBeInTheDocument();
  });

  it('states an honest quiet state when nothing is flagged', () => {
    mockUseNotifications.mockReturnValue(session([]));
    renderPanel();

    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
  });
});
