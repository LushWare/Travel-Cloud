import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BookingsPanel, { RefundSummary } from '../BookingsPanel';

const base = {
  id: 'b1', pnr: 'PNR-1', status: 'confirmed', travelers: [], totalAmount: 300, currency: 'USD',
  segments: [{ origin: 'CMB', destination: 'DXB', departureAt: '2027-02-15T08:00:00Z' }],
};

function renderPanel(booking, extra = {}) {
  return render(
    <BookingsPanel
      bookings={[booking]}
      filteredBookings={[booking]}
      loading={false}
      statusFilter="all"
      setStatusFilter={vi.fn()}
      statusCounts={{ all: 1, confirmed: 0, pending: 0, cancelled: 0, failed: 0 }}
      search=""
      setSearch={vi.fn()}
      onLoadBooking={vi.fn().mockResolvedValue(booking)}
      onRequestCancellationQuote={vi.fn()}
      onCancel={vi.fn()}
      {...extra}
    />,
  );
}

describe('airline changes in the bookings list', () => {
  it('labels a booking the airline changed', () => {
    renderPanel({ ...base, airlineChangeKind: 'changed', airlineChangeAt: '2027-01-01T00:00:00Z' });

    expect(screen.getByTestId('airline-change-badge')).toHaveTextContent('Changed by airline');
  });

  it('labels a booking cancelled outside the CRM', () => {
    renderPanel({ ...base, status: 'cancelled', airlineChangeKind: 'cancelled' });

    expect(screen.getByTestId('airline-change-badge')).toHaveTextContent('Cancelled outside the CRM');
  });

  it('shows no label on an unchanged booking', () => {
    renderPanel(base);

    expect(screen.queryByTestId('airline-change-badge')).not.toBeInTheDocument();
  });

  it('clears the label when the rep marks it as seen', async () => {
    const changed = { ...base, airlineChangeKind: 'changed', airlineChangeAt: '2027-01-01T00:00:00Z' };
    const onAcknowledgeAirlineChange = vi.fn().mockResolvedValue({ ...base });
    renderPanel(changed, { onAcknowledgeAirlineChange });

    await userEvent.click(screen.getByRole('button', { name: /Details/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Mark as seen/ }));

    expect(onAcknowledgeAirlineChange).toHaveBeenCalledWith('b1');
    await waitFor(() => expect(screen.queryByTestId('airline-change-alert')).not.toBeInTheDocument());
  });
});

describe('RefundSummary', () => {
  it("states what Duffel refunded to the agency's balance", () => {
    render(<RefundSummary booking={{ ...base, status: 'cancelled', refundAmount: 120.5, refundCurrency: 'USD', refundTo: 'balance' }} />);

    expect(screen.getByTestId('refund-summary')).toHaveTextContent(/Duffel refunded .*120\.50.* to your Duffel balance/);
  });

  it('reminds the rep that the customer is not refunded automatically', () => {
    render(<RefundSummary booking={{ ...base, status: 'cancelled', refundAmount: 0 }} />);

    expect(screen.getByTestId('refund-summary')).toHaveTextContent('Your customer has not been refunded yet');
  });

  it('says so when no refund amount was recorded', () => {
    render(<RefundSummary booking={{ ...base, status: 'cancelled' }} />);

    expect(screen.getByTestId('refund-summary')).toHaveTextContent('The refund amount was not recorded');
  });

  it('shows nothing for a booking that is not cancelled', () => {
    const { container } = render(<RefundSummary booking={base} />);

    expect(container).toBeEmptyDOMElement();
  });
});
