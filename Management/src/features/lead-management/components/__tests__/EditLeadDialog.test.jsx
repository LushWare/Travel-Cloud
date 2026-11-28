import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MANUAL_ITINERARY_VALUE = '__manual__';

const {
  mockGetPackageSelections,
  mockGetPackageSelection,
  mockAddPackageSelection,
  mockRemovePackageSelection,
  mockUpdatePackageSelectionItinerary,
  mockRefreshPackageSelection,
  mockUpdateLead,
  mockAssignLead,
  mockGetAllPackages,
} = vi.hoisted(() => ({
  mockGetPackageSelections: vi.fn(),
  mockGetPackageSelection: vi.fn(),
  mockAddPackageSelection: vi.fn(),
  mockRemovePackageSelection: vi.fn(),
  mockUpdatePackageSelectionItinerary: vi.fn(),
  mockRefreshPackageSelection: vi.fn(),
  mockUpdateLead: vi.fn(),
  mockAssignLead: vi.fn(),
  mockGetAllPackages: vi.fn(),
}));

vi.mock('../../../../services/api', () => ({
  leadAPI: {
    getPackageSelections: mockGetPackageSelections,
    getPackageSelection: mockGetPackageSelection,
    addPackageSelection: mockAddPackageSelection,
    removePackageSelection: mockRemovePackageSelection,
    updatePackageSelectionItinerary: mockUpdatePackageSelectionItinerary,
    refreshPackageSelection: mockRefreshPackageSelection,
    updateLead: mockUpdateLead,
    assignLead: mockAssignLead,
  },
  packageAPI: {
    getOptions: mockGetAllPackages,
  },
}));

vi.mock('@/lib/toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../LocationAutocomplete', () => ({
  default: ({ value, onChange }) => (
    <input aria-label="Departure City" value={value || ''} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock('../../../itinerary/components/ItineraryEditor', () => ({
  default: ({ days, onAddDay }) => (
    <div data-testid="itinerary-editor">
      <span data-testid="itinerary-days-count">{days?.length ?? 0}</span>
      <button type="button" onClick={onAddDay}>Add Day</button>
    </div>
  ),
}));

vi.mock('../../../itinerary/components/DestinationSelector', () => ({
  default: ({ value, onChange }) => (
    <input aria-label="Destination" value={value || ''} onChange={onChange} />
  ),
}));

vi.mock('../LeadFlightBookingsSection', () => ({
  default: ({ onFlightsChanged }) => (
    <div data-testid="flight-bookings">
      <button type="button" onClick={() => onFlightsChanged?.()}>Simulate flight change</button>
    </div>
  ),
}));

vi.mock('../LeadHotelBookingsSection', () => ({
  default: () => <div data-testid="hotel-bookings" />,
}));

vi.mock('../LeadPricingView', () => ({
  default: ({ selections, travelers }) => (
    <div data-testid="pricing-breakdown">
      <span data-testid="pricing-breakdown-selection">{selections[0]?.id}</span>
      <span data-testid="pricing-breakdown-travelers">{String(travelers)}</span>
    </div>
  ),
}));

vi.mock('../PricingSection', () => ({
  default: ({ selectionId, days, pricing, onSettingsChange, refreshToken }) => (
    <div data-testid="pricing-section">
      <span data-testid="pricing-selection-id">{String(selectionId)}</span>
      <span data-testid="pricing-margin-type">{String(pricing?.marginType)}</span>
      <span data-testid="pricing-margin-value">{String(pricing?.marginValue)}</span>
      <span data-testid="pricing-discount-type">{String(pricing?.discountType)}</span>
      <span data-testid="pricing-discount-value">{String(pricing?.discountValue)}</span>
      <span data-testid="pricing-days-count">{days?.length ?? 0}</span>
      <span data-testid="pricing-first-flight-transport-cost">{String(days?.[0]?.transports?.find(t => t.transportMode === 'FLIGHT')?.unitCost ?? '')}</span>
      <span data-testid="pricing-refresh-token">{String(refreshToken ?? 0)}</span>
      <button type="button" onClick={() => onSettingsChange({ ...pricing, marginValue: 99 })}>
        Change margin
      </button>
    </div>
  ),
}));

import EditLeadDialog from '../EditLeadDialog.tsx';

const PKG_A = 'pkg-a';
const PKG_B = 'pkg-b';

const packagesFixture = [
  { _id: PKG_A, title: 'Sri Lanka Explorer' },
  { _id: PKG_B, title: 'Maldives Getaway' },
];

const leadFixture = (overrides = {}) => ({
  _id: 'lead-1',
  name: 'John Doe',
  email: 'john@test.com',
  phone: '+94771234567',
  numberOfTravelers: 2,
  lifecycleStatus: 'DRAFTING',
  travelDate: '2026-01-01',
  endDate: '2026-01-10',
  remarks: [],
  ...overrides,
});

const selectionFixture = (overrides = {}) => ({
  id: 'sel-1',
  packageId: PKG_A,
  isManual: false,
  packageName: 'Sri Lanka Explorer',
  currentQuoteId: null,
  isMaterialized: true,
  pricing: {
    marginType: 'PERCENTAGE',
    marginValue: 10,
    depositType: 'PERCENTAGE',
    depositValue: 30,
    discountType: 'percentage',
    discountValue: 15,
    serviceChargeRate: 5,
  },
  itineraryDays: [{ dayNumber: 1, title: 'Day 1', places: [], activities: [], transports: [] }],
  ...overrides,
});

const editorSectionLabels = {
  personal: 'Contact',
  travel: 'Travel',
  package: 'Packages',
  pricing: 'Pricing',
  operations: 'Operations',
  remarks: 'Remarks',
};

function renderDialog({
  lead = leadFixture(), isOpen = true, onClose = vi.fn(), onSuccess = vi.fn(), onRequestStatusChange = vi.fn(), salesReps = [], initialSelectionId, section = 'package', operationsTab = 'flights',
} = {}) {
  const utils = render(
    <EditLeadDialog
      isOpen={isOpen}
      onClose={onClose}
      lead={lead}
      salesReps={salesReps}
      onSuccess={onSuccess}
      onRequestStatusChange={onRequestStatusChange}
      initialSelectionId={initialSelectionId}
    />
  );
  if (isOpen && lead) fireEvent.click(screen.getByRole('tab', { name: editorSectionLabels[section] }));
  if (isOpen && lead && section === 'operations' && operationsTab !== 'flights') {
    const tabLabels = { hotels: 'Hotel Bookings', pricing: 'Pricing' };
    fireEvent.click(screen.getByRole('tab', { name: tabLabels[operationsTab] }));
  }
  return { ...utils, onClose, onSuccess, onRequestStatusChange, lead };
}

beforeEach(() => {
  mockGetPackageSelections.mockReset();
  mockGetPackageSelection.mockReset();
  mockAddPackageSelection.mockReset();
  mockRemovePackageSelection.mockReset();
  mockUpdatePackageSelectionItinerary.mockReset();
  mockRefreshPackageSelection.mockReset();
  mockUpdateLead.mockReset();
  mockAssignLead.mockReset();
  mockGetAllPackages.mockReset();

  mockGetAllPackages.mockResolvedValue({ success: true, data: packagesFixture });
  mockGetPackageSelections.mockResolvedValue({ success: true, data: [selectionFixture()] });
  mockUpdateLead.mockResolvedValue({ success: true, data: {} });
  mockUpdatePackageSelectionItinerary.mockResolvedValue({ success: true, data: {} });
  mockAddPackageSelection.mockResolvedValue({ success: true, data: { id: 'sel-2' } });
  mockRefreshPackageSelection.mockResolvedValue({ success: true, data: {} });
});

describe('EditLeadDialog — load behavior', () => {
  it('shows the lead name in the header', async () => {
    renderDialog();
    expect(await screen.findByText('John Doe')).toBeInTheDocument();
  });

  it('opens on Contact and switches to one section at a time', async () => {
    const user = userEvent.setup();
    render(
      <EditLeadDialog isOpen={true} onClose={vi.fn()} lead={leadFixture()} salesReps={[]} onSuccess={vi.fn()} />
    );

    expect(screen.getByRole('tab', { name: 'Contact' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Full Name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Travel Date (Start)')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Travel' }));
    expect(screen.getByRole('tab', { name: 'Travel' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Travel Date (Start)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full Name')).not.toBeInTheDocument();
  });

  it('shows the assigned sales rep when the lead uses assignedToId', async () => {
    renderDialog({
      lead: leadFixture({ assignedToId: 'rep-1' }),
      salesReps: [{ id: 'rep-1', name: 'Alex Sales' }],
    });
    expect(await screen.findByText('Alex Sales')).toBeInTheDocument();
  });

  it('shows the current lifecycle status in Personal Information and opens the status workflow', async () => {
    let updateStatus;
    const user = userEvent.setup();
    const lead = leadFixture({ lifecycleStatus: 'DRAFTING' });
    const onRequestStatusChange = vi.fn((_, onStatusChanged) => { updateStatus = onStatusChanged; });
    renderDialog({ lead, section: 'personal', onRequestStatusChange });

    expect(screen.getByText('Drafting')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /change status/i }));
    expect(onRequestStatusChange).toHaveBeenCalledWith(lead, expect.any(Function));

    await act(async () => updateStatus('QUOTED'));
    expect(screen.getByText('Quoted')).toBeInTheDocument();
  });

  it('renders a tab for the lead current package once selections load', async () => {
    renderDialog();
    expect(await screen.findByRole('button', { name: 'Sri Lanka Explorer' })).toBeInTheDocument();
  });

  it('opens the selected package itinerary and day tabs by default', async () => {
    renderDialog();

    expect(await screen.findByTestId('itinerary-editor')).toBeInTheDocument();
  });

  it('lets the user open the package picker while package options are loading', async () => {
    mockGetAllPackages.mockReturnValue(new Promise(() => {}));
    renderDialog();
    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });

    const addPackageButton = screen.getByRole('button', { name: /add package/i });
    expect(addPackageButton).toBeEnabled();
    fireEvent.click(addPackageButton);

    expect(screen.getByLabelText('Add package')).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Manual Itinerary (No Package)' })).toBeInTheDocument();
  });

  it('queues a package addition until attached selections finish loading', async () => {
    const user = userEvent.setup();
    let resolveSelections;
    mockGetPackageSelections.mockReturnValue(new Promise((resolve) => { resolveSelections = resolve; }));
    mockGetPackageSelection.mockResolvedValue({
      success: true,
      data: selectionFixture({ id: 'sel-2', packageId: PKG_B, packageName: 'Maldives Getaway' }),
    });
    renderDialog();

    const addPackageButton = screen.getByRole('button', { name: /add package/i });
    expect(addPackageButton).toBeEnabled();
    expect(screen.getByText('Loading attached packages…')).toBeInTheDocument();
    expect(screen.queryByText(/no packages attached yet/i)).not.toBeInTheDocument();
    await user.click(addPackageButton);
    await user.selectOptions(screen.getByLabelText('Add package'), PKG_B);

    expect(await screen.findByText(/waiting for attached package details before adding/i)).toBeInTheDocument();
    expect(mockAddPackageSelection).not.toHaveBeenCalled();

    await act(async () => {
      resolveSelections({ success: true, data: [] });
    });

    await waitFor(() => expect(mockAddPackageSelection).toHaveBeenCalledWith('lead-1', { packageId: PKG_B }));
  });

  it('shows the Quoted badge on the package tab when the selection already has a quote', async () => {
    mockGetPackageSelections.mockResolvedValue({
      success: true,
      data: [selectionFixture({ currentQuoteId: 'quote-1' })],
    });
    renderDialog();
    await screen.findByText('Sri Lanka Explorer');
    expect(screen.getByText('Quoted')).toBeInTheDocument();
  });

  it('does not show the Quoted badge when the selection has no quote yet', async () => {
    renderDialog();
    await screen.findByText('Sri Lanka Explorer');
    expect(screen.queryByText('Quoted')).not.toBeInTheDocument();
  });

  it('loads saved pricing settings for the active tab into the pricing preview', async () => {
    renderDialog({ section: 'pricing' });
    await waitFor(() => expect(screen.getByTestId('pricing-margin-type')).toHaveTextContent('PERCENTAGE'));
    expect(screen.getByTestId('pricing-margin-value')).toHaveTextContent('10');
    expect(screen.getByTestId('pricing-discount-type')).toHaveTextContent('percentage');
    expect(screen.getByTestId('pricing-discount-value')).toHaveTextContent('15');
    expect(screen.getByTestId('pricing-selection-id')).toHaveTextContent('sel-1');
  });

  it('shows the saved breakdown for the active package in the Pricing tab', async () => {
    renderDialog({ section: 'pricing' });
    await waitFor(() => expect(screen.getByTestId('pricing-breakdown-selection')).toHaveTextContent('sel-1'));
  });

  it('tells the rep the breakdown is the saved one once pricing settings change', async () => {
    const user = userEvent.setup();
    renderDialog({ section: 'pricing' });
    await screen.findByTestId('pricing-section');
    await user.click(screen.getByRole('button', { name: /change margin/i }));
    expect(screen.getByText('This breakdown shows the last saved prices. Save changes to update it.')).toBeInTheDocument();
  });

  it('switches the priced package from the Pricing tab', async () => {
    mockGetPackageSelections.mockResolvedValue({
      success: true,
      data: [
        selectionFixture({ id: 'sel-1', packageId: PKG_A, packageName: 'Sri Lanka Explorer' }),
        selectionFixture({ id: 'sel-2', packageId: PKG_B, packageName: 'Maldives Getaway' }),
      ],
    });
    renderDialog({ section: 'pricing' });
    fireEvent.click(await screen.findByRole('tab', { name: 'Maldives Getaway' }));
    await waitFor(() => expect(screen.getByTestId('pricing-selection-id')).toHaveTextContent('sel-2'));
  });

  it('no longer lists Pricing under Operations', async () => {
    renderDialog({ section: 'operations' });
    const operations = screen.getByRole('tablist', { name: 'Operations details' });
    expect(within(operations).queryByRole('tab', { name: 'Pricing' })).not.toBeInTheDocument();
  });

  it('loads the active selection persisted itinerary days into the pricing preview', async () => {
    renderDialog({ section: 'pricing' });
    await waitFor(() => expect(screen.getByTestId('pricing-days-count')).toHaveTextContent('1'));
  });

  it('shows a placeholder and no pricing preview when the lead has no packages attached', async () => {
    mockGetPackageSelections.mockResolvedValue({ success: true, data: [] });
    renderDialog({ section: 'pricing' });
    expect(await screen.findByText(/add a package in packages to see its pricing/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pricing-section')).not.toBeInTheDocument();
  });

  it('blocks package additions when attached selections fail to load', async () => {
    mockGetPackageSelections.mockRejectedValue(new Error('temporary server error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent(/close and reopen this lead to retry/i);
    expect(screen.getByRole('button', { name: /add package/i })).toBeDisabled();
    expect(screen.queryByLabelText('Add package')).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('activates the tab matching initialSelectionId instead of defaulting to the first package', async () => {
    mockGetPackageSelections.mockResolvedValue({
      success: true,
      data: [
        selectionFixture({ id: 'sel-1', packageId: PKG_A, packageName: 'Sri Lanka Explorer' }),
        selectionFixture({ id: 'sel-2', packageId: PKG_B, packageName: 'Maldives Getaway' }),
      ],
    });
    renderDialog({ initialSelectionId: 'sel-2', section: 'pricing' });
    await waitFor(() => expect(screen.getByTestId('pricing-selection-id')).toHaveTextContent('sel-2'));
  });

  it('falls back to the first selection when initialSelectionId does not match any loaded selection', async () => {
    mockGetPackageSelections.mockResolvedValue({
      success: true,
      data: [
        selectionFixture({ id: 'sel-1', packageId: PKG_A, packageName: 'Sri Lanka Explorer' }),
        selectionFixture({ id: 'sel-2', packageId: PKG_B, packageName: 'Maldives Getaway' }),
      ],
    });
    renderDialog({ initialSelectionId: 'sel-does-not-exist', section: 'pricing' });
    await waitFor(() => expect(screen.getByTestId('pricing-selection-id')).toHaveTextContent('sel-1'));
  });
});

describe('EditLeadDialog — day-linked flight cost reconciliation', () => {
  it('reconciles a priced day flight into a FLIGHT transport row for the pricing preview', async () => {
    mockGetPackageSelections.mockResolvedValue({
      success: true,
      data: [selectionFixture({
        itineraryDays: [{
          dayNumber: 1, title: 'Day 1', places: [], activities: [], transports: [],
          flights: [{ id: 'f1', origin: 'CMB', destination: 'DXB', totalAmount: 150 }],
        }],
      })],
    });
    renderDialog({ section: 'pricing' });

    await waitFor(() => expect(screen.getByTestId('pricing-first-flight-transport-cost')).toHaveTextContent('150'));
  });

  it('sends the reconciled transport in the itinerary save payload', async () => {
    mockGetPackageSelections.mockResolvedValue({
      success: true,
      data: [selectionFixture({
        itineraryDays: [{
          dayNumber: 1, title: 'Day 1', places: [], activities: [], transports: [],
          flights: [{ id: 'f1', origin: 'CMB', destination: 'DXB', totalAmount: 150 }],
        }],
      })],
    });
    const user = userEvent.setup();
    renderDialog({ section: 'pricing' });

    await screen.findByTestId('pricing-first-flight-transport-cost');
    await user.click(screen.getByRole('button', { name: /change margin/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdatePackageSelectionItinerary).toHaveBeenCalledWith('lead-1', 'sel-1', expect.objectContaining({
      days: expect.arrayContaining([
        expect.objectContaining({
          transports: expect.arrayContaining([
            expect.objectContaining({ transportMode: 'FLIGHT', unitCost: 150 }),
          ]),
        }),
      ]),
    })));
  });

  it('bumps the pricing preview refreshToken when a transfer flight changes', async () => {
    const user = userEvent.setup();
    renderDialog({ section: 'operations' });

    expect(await screen.findByTestId('flight-bookings')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /simulate flight change/i }));

    await user.click(screen.getByRole('tab', { name: 'Pricing' }));
    expect(screen.getByTestId('pricing-refresh-token')).toHaveTextContent('1');
  });

  it('shows only the selected operations panel', async () => {
    const user = userEvent.setup();
    renderDialog({ section: 'operations' });

    expect(screen.queryByRole('button', { name: /change status/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Lifecycle Status')).not.toBeInTheDocument();
    expect(await screen.findByTestId('flight-bookings')).toBeInTheDocument();
    expect(screen.queryByTestId('hotel-bookings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pricing-section')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Hotel Bookings' }));
    expect(screen.getByTestId('hotel-bookings')).toBeInTheDocument();
    expect(screen.queryByTestId('flight-bookings')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Pricing' }));
    expect(screen.getByTestId('pricing-section')).toBeInTheDocument();
    expect(screen.queryByTestId('hotel-bookings')).not.toBeInTheDocument();
  });
});

describe('EditLeadDialog — flexible travel details', () => {
  it.each(['NEW', 'PENDING_VERIFICATION', 'DRAFTING', 'QUOTED', 'REVISION', 'APPROVED', 'BOOKING_IN_PROGRESS', 'CONFIRMED', 'CLOSED_LOST', 'BOOKING_FAILED', 'CANCELLED'])(
    'keeps travel dates and traveler count editable when status is %s',
    (status) => {
      renderDialog({ lead: leadFixture({ lifecycleStatus: status }), section: 'travel' });
      expect(screen.getByLabelText('Travel Date (Start)')).toBeEnabled();
      expect(screen.getByLabelText('End Date')).toBeEnabled();
      expect(screen.getByLabelText('Number of Travelers')).toBeEnabled();
      expect(screen.queryByText('Locked')).not.toBeInTheDocument();
    },
  );

  it('still allows adding a new package even when the lead is QUOTED', async () => {
    renderDialog({ lead: leadFixture({ lifecycleStatus: 'QUOTED' }) });
    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    expect(screen.getByRole('button', { name: /add package/i })).not.toBeDisabled();
  });

  it('the name field always stays editable, even when locked', async () => {
    renderDialog({ lead: leadFixture({ lifecycleStatus: 'QUOTED' }), section: 'personal' });
    expect(screen.getByLabelText('Full Name')).not.toBeDisabled();
  });
});

describe('EditLeadDialog — package tabs', () => {
  it('adds a new package tab and switches to it', async () => {
    mockGetPackageSelection.mockResolvedValue({
      success: true,
      data: selectionFixture({ id: 'sel-2', packageId: PKG_B, packageName: 'Maldives Getaway', isMaterialized: false, itineraryDays: [], pricing: null }),
    });
    const user = userEvent.setup();
    renderDialog();

    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    await user.click(screen.getByRole('button', { name: /add package/i }));
    await user.selectOptions(screen.getByLabelText('Add package'), PKG_B);

    expect(await screen.findByRole('button', { name: 'Maldives Getaway' })).toBeInTheDocument();
    expect(mockAddPackageSelection).toHaveBeenCalledWith('lead-1', { packageId: PKG_B });
    fireEvent.click(screen.getByRole('tab', { name: 'Operations' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Pricing' }));
    await waitFor(() => expect(screen.getByTestId('pricing-selection-id')).toHaveTextContent('sel-2'));
  });

  it('adds a manual itinerary slot', async () => {
    mockGetPackageSelection.mockResolvedValue({
      success: true,
      data: selectionFixture({ id: 'sel-3', packageId: null, isManual: true, packageName: null, isMaterialized: false, itineraryDays: [{ dayNumber: 1, places: [], activities: [], transports: [] }], pricing: null }),
    });
    const user = userEvent.setup();
    renderDialog();

    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    await user.click(screen.getByRole('button', { name: /add package/i }));
    await user.selectOptions(screen.getByLabelText('Add package'), MANUAL_ITINERARY_VALUE);

    expect(await screen.findByRole('button', { name: 'Manual Itinerary' })).toBeInTheDocument();
    expect(mockAddPackageSelection).toHaveBeenCalledWith('lead-1', { isManual: true });
  });

  it('removes a package tab after confirming', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderDialog();

    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    await user.click(screen.getByTitle('Remove package'));

    await waitFor(() => expect(mockRemovePackageSelection).toHaveBeenCalledWith('lead-1', 'sel-1'));
    confirmSpy.mockRestore();
  });

  it('does not remove the tab when the confirm dialog is dismissed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderDialog();

    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    await user.click(screen.getByTitle('Remove package'));

    expect(mockRemovePackageSelection).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('EditLeadDialog — refresh from original package', () => {
  // The itinerary editor (and its Refresh button) is collapsed by default;
  // clicking the active package's tab expands it, same as picking a tab
  // manually would in the running app.
  async function openItineraryEditor(user) {
    await user.click(await screen.findByRole('button', { name: 'Sri Lanka Explorer' }));
  }

  it('is disabled while the selection is still pristine', async () => {
    mockGetPackageSelections.mockResolvedValue({ success: true, data: [selectionFixture({ isMaterialized: false })] });
    const user = userEvent.setup();
    renderDialog();

    await openItineraryEditor(user);
    expect(screen.getByRole('button', { name: /refresh from original package/i })).toBeDisabled();
  });

  it('refreshes a materialized (edited) selection', async () => {
    mockGetPackageSelection.mockResolvedValue({ success: true, data: selectionFixture({ isMaterialized: false }) });
    const user = userEvent.setup();
    renderDialog();

    await openItineraryEditor(user);
    await user.click(screen.getByRole('button', { name: /refresh from original package/i }));

    await waitFor(() => expect(mockRefreshPackageSelection).toHaveBeenCalledWith('lead-1', 'sel-1', false));
  });

  it('prompts to confirm and retries with force when the selection has already been quoted', async () => {
    const blockedError = new Error('already quoted');
    blockedError.status = 409;
    blockedError.data = { code: 'REFRESH_BLOCKED_QUOTED' };
    mockRefreshPackageSelection.mockRejectedValueOnce(blockedError).mockResolvedValueOnce({ success: true, data: {} });
    mockGetPackageSelection.mockResolvedValue({ success: true, data: selectionFixture({ isMaterialized: false }) });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderDialog();

    await openItineraryEditor(user);
    await user.click(screen.getByRole('button', { name: /refresh from original package/i }));

    await waitFor(() => expect(mockRefreshPackageSelection).toHaveBeenCalledWith('lead-1', 'sel-1', true));
    confirmSpy.mockRestore();
  });
});

describe('EditLeadDialog — View Details button', () => {
  function renderWithViewDetails() {
    const onViewDetails = vi.fn();
    const onClose = vi.fn();
    const lead = leadFixture();
    render(
      <EditLeadDialog isOpen onClose={onClose} lead={lead} salesReps={[]} onSuccess={vi.fn()} onViewDetails={onViewDetails} />
    );
    return { onViewDetails, onClose, lead };
  }

  async function editName(user) {
    const nameInput = await screen.findByLabelText('Full Name');
    await waitFor(() => expect(nameInput).toHaveValue('John Doe'));
    await user.clear(nameInput);
    await user.type(nameInput, 'Edited Name');
  }

  afterEach(() => vi.restoreAllMocks());

  it('is not shown when the parent offers no details view', async () => {
    renderDialog();
    await screen.findByText('John Doe');
    expect(screen.queryByRole('button', { name: 'View Details' })).not.toBeInTheDocument();
  });

  it('hands the lead to onViewDetails when nothing was edited', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { onViewDetails, lead } = renderWithViewDetails();
    await screen.findByLabelText('Full Name');

    await user.click(screen.getByRole('button', { name: 'View Details' }));

    expect(onViewDetails).toHaveBeenCalledWith(lead);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('does not call onClose, so no quotation/voucher hand-off resumes', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWithViewDetails();
    await screen.findByLabelText('Full Name');

    await user.click(screen.getByRole('button', { name: 'View Details' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before discarding unsaved edits', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onViewDetails } = renderWithViewDetails();
    await editName(user);

    await user.click(screen.getByRole('button', { name: 'View Details' }));

    expect(confirmSpy).toHaveBeenCalledWith('You have unsaved changes. Discard them and view details?');
    expect(onViewDetails).toHaveBeenCalledTimes(1);
  });

  it('stays in the editor with the edits kept when the discard prompt is dismissed', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onViewDetails } = renderWithViewDetails();
    await editName(user);

    await user.click(screen.getByRole('button', { name: 'View Details' }));

    expect(onViewDetails).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Full Name')).toHaveValue('Edited Name');
  });

  it('never saves when switching to details', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithViewDetails();
    await editName(user);

    await user.click(screen.getByRole('button', { name: 'View Details' }));

    expect(mockUpdateLead).not.toHaveBeenCalled();
  });
});

describe('EditLeadDialog — cancel discards unsaved changes', () => {
  it('calls onClose without saving anything', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockUpdateLead).not.toHaveBeenCalled();
  });

  it('reverts an edited name back to the saved value after cancel, even if reopened with the same lead reference', async () => {
    const user = userEvent.setup();
    const lead = leadFixture();
    const onClose = vi.fn();
    const { rerender } = render(
      <EditLeadDialog isOpen={true} onClose={onClose} lead={lead} salesReps={[]} onSuccess={vi.fn()} />
    );

    const nameInput = await screen.findByLabelText('Full Name');
    await waitFor(() => expect(nameInput).toHaveValue('John Doe'));
    await user.clear(nameInput);
    await user.type(nameInput, 'Edited Name');
    expect(nameInput).toHaveValue('Edited Name');

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();

    rerender(<EditLeadDialog isOpen={false} onClose={onClose} lead={lead} salesReps={[]} onSuccess={vi.fn()} />);
    rerender(<EditLeadDialog isOpen={true} onClose={onClose} lead={lead} salesReps={[]} onSuccess={vi.fn()} />);

    expect(await screen.findByLabelText('Full Name')).toHaveValue('John Doe');
  });
});

describe('EditLeadDialog — customer budget', () => {
  it('saves the customer budget the rep types', async () => {
    const user = userEvent.setup();
    renderDialog({ section: 'travel' });

    const budget = screen.getByLabelText('Customer Budget');
    await user.clear(budget);
    await user.type(budget, 'USD 3,000');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateLead).toHaveBeenCalled());
    expect(mockUpdateLead.mock.calls[0][1].budget).toBe('USD 3,000');
  });

  it('shows the quote total and how far it is over budget', () => {
    renderDialog({ section: 'travel', lead: leadFixture({ budget: '3000', quoteTotal: { amount: 3450, currency: 'USD' } }) });
    expect(screen.getByText('Quote total: USD 3,450 — USD 450 over budget')).toBeInTheDocument();
  });

  it('says when no package is priced yet', () => {
    renderDialog({ section: 'travel', lead: leadFixture({ budget: '3000', quoteTotal: null }) });
    expect(screen.getByText('No package priced yet')).toBeInTheDocument();
  });
});

describe('EditLeadDialog — save behavior', () => {
  it('saves core lead fields in a single updateLead call when nothing else changed', async () => {
    const user = userEvent.setup();
    renderDialog();

    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateLead).toHaveBeenCalledTimes(1));
    expect(mockUpdatePackageSelectionItinerary).not.toHaveBeenCalled();
    // Package identity no longer travels through updateLead — it's managed via /packages.
    expect(mockUpdateLead.mock.calls[0][1]).not.toHaveProperty('packageId');
    expect(mockUpdateLead.mock.calls[0][1]).not.toHaveProperty('pricing');
  });

  it('persists a dirty selection through updatePackageSelectionItinerary before updateLead', async () => {
    const user = userEvent.setup();
    renderDialog({ section: 'pricing' });

    await screen.findByTestId('pricing-selection-id');
    await user.click(screen.getByRole('button', { name: /change margin/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdatePackageSelectionItinerary).toHaveBeenCalledWith('lead-1', 'sel-1', expect.objectContaining({
      pricing: expect.objectContaining({ marginValue: 99 }),
    })));
    expect(mockUpdateLead).toHaveBeenCalled();

    const itineraryCallOrder = mockUpdatePackageSelectionItinerary.mock.invocationCallOrder[0];
    const updateLeadCallOrder = mockUpdateLead.mock.invocationCallOrder[0];
    expect(itineraryCallOrder).toBeLessThan(updateLeadCallOrder);
  });

  it('calls onSuccess and onClose after a successful save', async () => {
    const user = userEvent.setup();
    const { onClose, onSuccess } = renderDialog();

    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error and keeps the dialog open when updateLead fails', async () => {
    mockUpdateLead.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    const { onClose, onSuccess } = renderDialog();

    await screen.findByRole('button', { name: 'Sri Lanka Explorer' });
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateLead).toHaveBeenCalled());
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not call updateLead when saving a dirty selection fails', async () => {
    mockUpdatePackageSelectionItinerary.mockRejectedValue(new Error('Itinerary save failed'));
    const user = userEvent.setup();
    renderDialog({ section: 'pricing' });

    await screen.findByTestId('pricing-selection-id');
    await user.click(screen.getByRole('button', { name: /change margin/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdatePackageSelectionItinerary).toHaveBeenCalled());
    expect(mockUpdateLead).not.toHaveBeenCalled();
  });
});

describe('EditLeadDialog — visibility', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = renderDialog({ isOpen: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when lead is null', () => {
    const { container } = render(
      <EditLeadDialog isOpen={true} onClose={vi.fn()} lead={null} salesReps={[]} onSuccess={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
