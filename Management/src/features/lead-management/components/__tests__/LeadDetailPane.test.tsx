import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const {
  mockGetAllLeads, mockGetLeadStats, mockGetSalesReps, mockGetAssignmentSettings, mockGetStoredUser,
} = vi.hoisted(() => ({
  mockGetAllLeads: vi.fn(),
  mockGetLeadStats: vi.fn(),
  mockGetSalesReps: vi.fn(),
  mockGetAssignmentSettings: vi.fn(),
  mockGetStoredUser: vi.fn(),
}));

vi.mock('../../../../services/api', () => ({
  leadAPI: {
    getAllLeads: mockGetAllLeads,
    getLeadStats: mockGetLeadStats,
    getAssignmentSettings: mockGetAssignmentSettings,
  },
  adminAPI: { getSalesReps: mockGetSalesReps },
  authAPI: { getStoredUser: mockGetStoredUser },
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
}));

vi.mock('@/lib/toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

// Page chrome unrelated to the detail pane / copilot scope coupling.
vi.mock('../../../../features/lead-management/components/LeadStats', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/LeadFilters', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/NewLeadDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/RemarksDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/WhatsAppHistoryDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/FilterDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/SettingsDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/StatusChangeDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/ActiveSalesRepsDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/LeadSectionView', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/quotation/QuotationModal', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/InvoiceDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/ReceiptDialog', () => ({ default: () => null }));
vi.mock('../../../../features/lead-management/components/VoucherDialog', () => ({ default: () => null }));

vi.mock('../../../../features/lead-management/components/EditLeadDialog', () => ({
  default: ({ isOpen, lead }: { isOpen: boolean; lead: { name?: string } | null }) =>
    isOpen ? <div data-testid="edit-lead-dialog">{lead?.name}</div> : null,
}));

import { AuthProvider } from '../../../../contexts/AuthContext';
import LeadManagement from '../../../../pages/LeadManagement';

const lead = {
  _id: 'lead-a',
  name: 'Alice Traveller',
  lifecycleStatus: 'NEW',
  destination: 'Lisbon',
  budget: 2500,
  assignedToId: 'rep-1',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
};

function renderPage() {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify({ _id: 'actor-1', name: 'Ops' }));
  return render(
    <AuthProvider>
      <LeadManagement />
    </AuthProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockGetAllLeads.mockResolvedValue({ success: true, data: [lead], pagination: { pages: 1, total: 1 } });
  mockGetLeadStats.mockResolvedValue({ success: true, summary: { total: 1 }, data: [] });
  mockGetSalesReps.mockResolvedValue({ success: true, data: [{ id: 'rep-1', name: 'Rita Rep' }] });
  mockGetAssignmentSettings.mockResolvedValue({ success: true, data: {} });
  mockGetStoredUser.mockReturnValue({ role: 'admin' });

});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('LeadDetailPane', () => {
  it('renders the selected lead facts and assigned representative', async () => {
    const user = userEvent.setup();
    renderPage();

    const row = await screen.findByText('Alice Traveller');
    await user.click(row);

    const pane = screen.getByRole('complementary', { name: 'Lead detail' });
    expect(pane).toHaveTextContent('Lisbon');
    expect(pane).toHaveTextContent('2,500');
    expect(pane).toHaveTextContent('Rita Rep');
    expect(pane).not.toHaveTextContent('rep-1');
  });

  it('falls back to the assignee id prefix when the rep is not in the active list', async () => {
    mockGetSalesReps.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Alice Traveller'));
    const pane = screen.getByRole('complementary', { name: 'Lead detail' });
    await waitFor(() => expect(pane).toHaveTextContent('rep-1'));
  });

});
