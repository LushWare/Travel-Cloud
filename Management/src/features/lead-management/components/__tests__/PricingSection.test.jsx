import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const { mockCalculateSelectionPricing, mockPreviewPricing } = vi.hoisted(() => ({
  mockCalculateSelectionPricing: vi.fn(),
  mockPreviewPricing: vi.fn(),
}));

vi.mock('../../../../services/api', () => ({
  leadAPI: { calculateSelectionPricing: mockCalculateSelectionPricing, previewPricing: mockPreviewPricing },
}));

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import PricingSection from '../PricingSection';

const financialsFixture = (overrides = {}) => ({
  estimatedTotal: 1000,
  sellSubtotal: 1100,
  taxAmount: 198,
  totalAmount: 1298,
  depositAmount: 389.4,
  ...overrides,
});

beforeEach(() => {
  mockCalculateSelectionPricing.mockReset();
  mockPreviewPricing.mockReset();
  mockCalculateSelectionPricing.mockResolvedValue({ data: { financials: financialsFixture() } });
  mockPreviewPricing.mockResolvedValue({ data: { financials: financialsFixture() } });
});

describe('PricingSection — leadId/selectionId routing', () => {
  it('calls calculateSelectionPricing when both leadId and selectionId are present', async () => {
    render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);

    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledWith('lead-1', 'sel-1', expect.objectContaining({ days: [], travelers: 2 })));
    expect(mockPreviewPricing).not.toHaveBeenCalled();
  });

  it('calls previewPricing when there is no leadId (new lead)', async () => {
    render(<PricingSection days={[]} travelers={1} />);

    await waitFor(() => expect(mockPreviewPricing).toHaveBeenCalled());
    expect(mockCalculateSelectionPricing).not.toHaveBeenCalled();
  });

  it('calls previewPricing when leadId is present but selectionId is not (no package attached yet)', async () => {
    render(<PricingSection leadId="lead-1" days={[]} travelers={1} />);

    await waitFor(() => expect(mockPreviewPricing).toHaveBeenCalled());
    expect(mockCalculateSelectionPricing).not.toHaveBeenCalled();
  });
});

describe('PricingSection — recomputes on relevant changes', () => {
  it('recomputes when days changes', async () => {
    const { rerender } = render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledTimes(1));
    mockCalculateSelectionPricing.mockClear();

    rerender(<PricingSection leadId="lead-1" selectionId="sel-1" days={[{ dayNumber: 1 }]} travelers={2} />);

    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledTimes(1));
  });

  it('recomputes when travelers changes', async () => {
    const { rerender } = render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledTimes(1));
    mockCalculateSelectionPricing.mockClear();

    rerender(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={3} />);

    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledWith('lead-1', 'sel-1', expect.objectContaining({ travelers: 3 })));
  });

  it('recomputes when the active selection tab changes', async () => {
    const { rerender } = render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledTimes(1));
    mockCalculateSelectionPricing.mockClear();

    rerender(<PricingSection leadId="lead-1" selectionId="sel-2" days={[]} travelers={2} />);

    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledWith('lead-1', 'sel-2', expect.anything()));
  });
});

describe('PricingSection — refreshToken (transfer flight changes)', () => {
  it('recomputes when refreshToken changes even though days/travelers/settings are unchanged', async () => {
    const days = [];
    const { rerender } = render(<PricingSection leadId="lead-1" selectionId="sel-1" days={days} travelers={2} refreshToken={0} />);
    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledTimes(1));
    mockCalculateSelectionPricing.mockClear();

    // Same days reference, same travelers — only refreshToken bumps, as
    // EditLeadDialog does after LeadFlightBookingsSection reports a change.
    rerender(<PricingSection leadId="lead-1" selectionId="sel-1" days={days} travelers={2} refreshToken={1} />);

    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledTimes(1));
  });

  it('does not recompute on a re-render where nothing — including refreshToken — changed', async () => {
    const days = [];
    const { rerender } = render(<PricingSection leadId="lead-1" selectionId="sel-1" days={days} travelers={2} refreshToken={0} />);
    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledTimes(1));
    mockCalculateSelectionPricing.mockClear();

    rerender(<PricingSection leadId="lead-1" selectionId="sel-1" days={days} travelers={2} refreshToken={0} />);

    // Give the (non-existent) debounce a moment, then confirm it never fired.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mockCalculateSelectionPricing).not.toHaveBeenCalled();
  });

  it('reflects the updated total after a refreshToken-triggered recompute', async () => {
    mockCalculateSelectionPricing.mockResolvedValueOnce({ data: { financials: financialsFixture({ totalAmount: 1298 }) } });
    const { rerender } = render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} refreshToken={0} />);
    expect(await screen.findByText('$1,298.00')).toBeInTheDocument();

    // A transfer flight was just added server-side — same days, new total.
    mockCalculateSelectionPricing.mockResolvedValueOnce({ data: { financials: financialsFixture({ totalAmount: 1798 }) } });
    rerender(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} refreshToken={1} />);

    expect(await screen.findByText('$1,798.00')).toBeInTheDocument();
  });
});

describe('PricingSection — tax and deposit/advance', () => {
  it('labels the tax line with the rate the server priced at, not a fixed 18%', async () => {
    mockCalculateSelectionPricing.mockResolvedValue({ data: { financials: financialsFixture({ taxRate: 8 }) } });
    render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    expect(await screen.findByText('Tax (8%):')).toBeInTheDocument();
  });

  it('sends no tax rate when the field is blank, so the Settings rate applies', async () => {
    render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledWith('lead-1', 'sel-1', expect.objectContaining({ taxRate: null })));
  });

  it('shows the Settings rate as the placeholder when the field is blank', async () => {
    mockCalculateSelectionPricing.mockResolvedValue({ data: { financials: financialsFixture({ taxRate: 12 }) } });
    render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    await waitFor(() => expect(screen.getByLabelText('Tax %')).toHaveAttribute('placeholder', 'Settings: 12%'));
  });

  it('loads a package\'s own saved tax rate into the field', () => {
    render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} pricing={{ taxRate: '5.00' }} />);
    expect(screen.getByLabelText('Tax %')).toHaveValue(5);
  });

  it('sends a typed tax rate with the preview', async () => {
    render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    fireEvent.change(screen.getByLabelText('Tax %'), { target: { value: '7.5' } });
    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenLastCalledWith('lead-1', 'sel-1', expect.objectContaining({ taxRate: 7.5 })));
  });

  it('starts with no deposit/advance instead of a built-in 30%', async () => {
    render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    await waitFor(() => expect(mockCalculateSelectionPricing).toHaveBeenCalledWith('lead-1', 'sel-1', expect.objectContaining({ depositValue: 0 })));
  });

  it('calls the advance "Deposit/Advance"', async () => {
    render(<PricingSection leadId="lead-1" selectionId="sel-1" days={[]} travelers={2} />);
    expect(screen.getByText('Deposit/Advance')).toBeInTheDocument();
    expect(await screen.findByText('Deposit/Advance:')).toBeInTheDocument();
  });
});
