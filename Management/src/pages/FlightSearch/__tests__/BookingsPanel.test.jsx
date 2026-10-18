import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BookingsPanel from '../BookingsPanel';
import { BOOKINGS_PAGE_SIZE } from '../helpers';

const booking = (index, status, segments) => ({
  id: `booking-${index}`,
  pnr: `PNR-${index}`,
  status,
  segments,
  travelers: [],
  totalAmount: 300,
  currency: 'USD',
});

const seg = (origin, destination, departureAt) => ({ origin, destination, departureAt });

function renderPanel(bookings) {
  return render(
    <BookingsPanel
      bookings={bookings}
      filteredBookings={bookings}
      loading={false}
      statusFilter="all"
      setStatusFilter={vi.fn()}
      statusCounts={{ all: bookings.length, confirmed: 0, pending: 0, cancelled: 0, failed: 0 }}
      search=""
      setSearch={vi.fn()}
      cancelDialog={null}
      setCancelDialog={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

describe('BookingsPanel', () => {
  it('describes a round-trip booking by its whole route', () => {
    renderPanel([
      booking(1, 'confirmed', [
        seg('CMB', 'DXB', '2026-08-01T08:00:00Z'),
        seg('DXB', 'CMB', '2026-08-08T08:00:00Z'),
      ]),
    ]);

    expect(screen.getByText('CMB → DXB → CMB')).toBeInTheDocument();
  });

  it('renders one page of bookings and offers the next page', async () => {
    const bookings = Array.from({ length: 30 }, (_, i) =>
      booking(i + 1, 'confirmed', [seg('CMB', 'DXB', '2026-08-01T08:00:00Z')]),
    );
    renderPanel(bookings);

    expect(screen.getAllByText(/^PNR-\d+$/)).toHaveLength(BOOKINGS_PAGE_SIZE);
    expect(screen.getByText(`Showing ${BOOKINGS_PAGE_SIZE} of 30 bookings`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show 5 more' }));

    expect(screen.getAllByText(/^PNR-\d+$/)).toHaveLength(30);
    expect(screen.getByText('Showing 30 of 30 bookings')).toBeInTheDocument();
  });
});
