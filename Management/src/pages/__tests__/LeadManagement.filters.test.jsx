import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  mockGetAllLeads, mockGetLeadStats, mockGetSalesReps, mockGetAssignmentSettings, mockGetStoredUser,
  router,
} = vi.hoisted(() => ({
  mockGetAllLeads: vi.fn(),
  mockGetLeadStats: vi.fn(),
  mockGetSalesReps: vi.fn(),
  mockGetAssignmentSettings: vi.fn(),
  mockGetStoredUser: vi.fn(),
  router: { params: new URLSearchParams(), setParams: vi.fn() },
}));

vi.mock('../../services/api', () => ({
  leadAPI: { getAllLeads: mockGetAllLeads, getLeadStats: mockGetLeadStats, getAssignmentSettings: mockGetAssignmentSettings },
  adminAPI: { getSalesReps: mockGetSalesReps },
  authAPI: { getStoredUser: mockGetStoredUser },
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [router.params, router.setParams],
  useNavigate: () => vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Keep LeadFilters real so we can drive its status tabs; stub the rest so this
// suite only guards the filter -> fetch wiring.
vi.mock('../../features/lead-management/components/LeadStats', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/LeadTable', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/NewLeadDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/EditLeadDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/RemarksDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/WhatsAppHistoryDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/FilterDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/SettingsDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/StatusChangeDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/ActiveSalesRepsDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/LeadDetailPane', () => ({
  default: ({ lead }) => <div data-testid="lead-detail">{lead?.id || lead?._id || 'empty'}</div>,
}));
vi.mock('../../features/lead-management/components/LeadSectionView', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/quotation/QuotationModal', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/InvoiceDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/ReceiptDialog', () => ({ default: () => null }));
vi.mock('../../features/lead-management/components/VoucherDialog', () => ({ default: () => null }));

import LeadManagement from '../LeadManagement';

beforeEach(() => {
  vi.clearAllMocks();
  router.params = new URLSearchParams();
  router.setParams.mockReset();
  mockGetAllLeads.mockResolvedValue({ success: true, data: [], pagination: { pages: 1, total: 0 } });
  mockGetLeadStats.mockResolvedValue({ success: true, summary: { total: 0 }, data: [] });
  mockGetSalesReps.mockResolvedValue({ success: true, data: [] });
  mockGetAssignmentSettings.mockResolvedValue({ success: true, data: {} });
  mockGetStoredUser.mockReturnValue(null);
});

function lastParams() {
  const calls = mockGetAllLeads.mock.calls;
  return calls[calls.length - 1][0];
}

describe('LeadManagement — PENDING_VERIFICATION filter wiring', () => {
  it('fires getAllLeads with lifecycleStatus=PENDING_VERIFICATION when the filter is selected', async () => {
    const user = userEvent.setup();
    render(<LeadManagement />);
    await waitFor(() => expect(mockGetAllLeads).toHaveBeenCalled());

    const tab = await screen.findByRole('tab', { name: /pending verification/i });
    await user.click(tab);

    await waitFor(() => {
      expect(lastParams()).toMatchObject({ lifecycleStatus: 'PENDING_VERIFICATION' });
    });
  });

  it('keeps using the status param for non-PENDING_VERIFICATION statuses', async () => {
    const user = userEvent.setup();
    render(<LeadManagement />);
    await waitFor(() => expect(mockGetAllLeads).toHaveBeenCalled());

    const tab = await screen.findByRole('tab', { name: /drafting/i });
    await user.click(tab);

    await waitFor(() => {
      const params = lastParams();
      expect(params).toMatchObject({ status: 'DRAFTING' });
      expect(params).not.toHaveProperty('lifecycleStatus');
    });
  });
});

describe('LeadManagement — notification deep links', () => {
  it('requests and labels only the lead ids named by the URL', async () => {
    router.params = new URLSearchParams('ids=lead-1%2Clead-2');
    mockGetAllLeads.mockResolvedValue({
      success: true,
      data: [{ id: 'lead-1' }, { id: 'lead-2' }],
      pagination: { pages: 1, total: 2 },
    });

    render(<LeadManagement />);

    await waitFor(() => expect(lastParams()).toMatchObject({
      ids: 'lead-1,lead-2',
      limit: 200,
      page: 1,
    }));
    expect(await screen.findByText(/Active filter: linked leads/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^All/ })).not.toBeInTheDocument();
  });

  it('opens the requested lead detail when open=1 accompanies leadId', async () => {
    router.params = new URLSearchParams('leadId=lead-1&open=1');
    mockGetAllLeads.mockResolvedValue({
      success: true,
      data: [{ id: 'lead-1', name: 'Alice' }],
      pagination: { pages: 1, total: 1 },
    });

    render(<LeadManagement />);

    await waitFor(() => expect(screen.getByTestId('lead-detail')).toHaveTextContent('lead-1'));
  });
});
