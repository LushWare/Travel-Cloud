import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PackageDetailsModal from '../PackageDetailsModal';

const LONG_DESTINATION = 'Nuwara Eliya, Kandy, Ella and Yala National Park';

const pkg = {
  id: 'pkg-1',
  title: 'Bali Escape',
  destination: LONG_DESTINATION,
  durationDays: 7,
  category: 'honeymoon',
  basePrice: 1200,
  rating: 4.333333333333333,
  numReviews: 12,
  isActive: true,
  inclusions: [],
  exclusions: [],
  images: [],
};

const renderModal = (overrides = {}) =>
  render(<PackageDetailsModal pkg={{ ...pkg, ...overrides }} onClose={vi.fn()} />);

describe('PackageDetailsModal quick info', () => {
  it('shows an Edit Details header action when editing is available', () => {
    const onEdit = vi.fn();
    render(<PackageDetailsModal pkg={pkg} onClose={vi.fn()} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Details' }));

    expect(onEdit).toHaveBeenCalledWith(pkg);
  });

  it('shows package facts and price details in two responsive rows', () => {
    renderModal();

    const grid = screen.getByText(LONG_DESTINATION).closest('.grid');
    expect(grid?.className).toContain('xl:grid-cols-3');
    expect(Array.from(grid?.children || []).map((card) => card.querySelector('p')?.textContent)).toEqual([
      'Category',
      'Destination',
      'Duration',
      'Price per person (twin sharing)',
      'Margin',
      'Reviews',
    ]);
  });

  it('lets a long value wrap inside its box rather than overflow it', () => {
    renderModal();

    const value = screen.getByText(LONG_DESTINATION);
    expect(value.className).toContain('break-words');
    // The wrapper must be allowed to shrink below its content's min-content width,
    // which is the flex default that caused the overflow.
    expect(value.parentElement?.className).toContain('min-w-0');
    expect(value.closest('.min-w-0')).not.toBeNull();
  });

  it('rounds the rating it shows', () => {
    renderModal();

    expect(screen.queryByText('4.333333333333333')).not.toBeInTheDocument();
    expect(screen.getByText('4.3 (12)')).toBeInTheDocument();
  });

  it('rounds a fractional margin rather than printing every digit', () => {
    renderModal({ defaultMarginType: 'PERCENTAGE', defaultMarginInput: 12.3456789 });

    expect(screen.getByText('12.35%')).toBeInTheDocument();
    expect(screen.queryByText('12.3456789%')).not.toBeInTheDocument();
  });

  it('shows pricing in Basic Information without the old section header or tab', () => {
    renderModal();

    expect(screen.getByText('Price per person (twin sharing)')).toBeInTheDocument();
    expect(screen.queryByText('Price Calculation')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Price Calculation' })).not.toBeInTheDocument();
  });

  it('shows rating, review count, and bookings in the Basic Information footer', () => {
    renderModal({ bookings: 7 });

    const performance = screen.getByLabelText('Package performance');
    expect(performance).toHaveTextContent('4.3');
    expect(performance).toHaveTextContent('12');
    expect(performance).toHaveTextContent('7');
    expect(performance).toHaveTextContent('out of 5');
    expect(performance).toHaveTextContent('reviews');
    expect(performance).toHaveTextContent('bookings');
    expect(performance.firstElementChild).toHaveClass('bg-white', 'text-black');
    expect(performance.firstElementChild?.firstElementChild).toHaveClass('bg-gray-100');
  });

  it('falls back to N/A for a missing value', () => {
    renderModal({ destination: null });

    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  });
});

describe('PackageDetailsModal itinerary loading', () => {
  it('shows itinerary days as tabs and switches the visible day', () => {
    renderModal({
      days: [
        { dayNumber: 1, title: 'Arrival', description: 'Check in and settle.' },
        { dayNumber: 2, title: 'Explore Ella', description: 'Visit the tea gardens.' },
      ],
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Day-wise Itinerary' }));

    expect(screen.getByRole('tab', { name: 'Day 1: Arrival' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Check in and settle.')).toBeInTheDocument();
    expect(screen.queryByText('Visit the tea gardens.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Day 2: Explore Ella' }));

    expect(screen.getByRole('tab', { name: 'Day 2: Explore Ella' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Visit the tea gardens.')).toBeInTheDocument();
    expect(screen.queryByText('Check in and settle.')).not.toBeInTheDocument();
  });

  it('shows the day hotel with its room, meal plan and nightly room price', () => {
    renderModal({
      days: [{
        dayNumber: 1,
        title: 'Arrival',
        accommodation: {
          name: 'Kaani Grand Seaview',
          hotelImage: 'https://img/kaani.jpg',
          roomType: 'Deluxe Double',
          boardType: 'Breakfast Included',
          totalAmount: 120,
          currency: 'USD',
        },
      }],
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Day-wise Itinerary' }));

    expect(screen.getByText('Kaani Grand Seaview')).toBeInTheDocument();
    expect(screen.getByAltText('Kaani Grand Seaview')).toHaveAttribute('src', 'https://img/kaani.jpg');
    expect(screen.getByText('Deluxe Double')).toBeInTheDocument();
    expect(screen.getByText('Breakfast Included')).toBeInTheDocument();
    expect(screen.getByText(/\$120\.00 \/ room \/ night/)).toBeInTheDocument();
  });

  it('shows an itinerary spinner rather than "No itinerary" while full details load', () => {
    render(<PackageDetailsModal pkg={pkg} isLoadingDetails onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Day-wise Itinerary' }));

    expect(screen.getByText('Loading itinerary...')).toBeInTheDocument();
    expect(screen.queryByText('No itinerary specified')).not.toBeInTheDocument();
  });

  it('shows "No itinerary" once loading finishes without any days', () => {
    render(<PackageDetailsModal pkg={pkg} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Day-wise Itinerary' }));

    expect(screen.getByText('No itinerary specified')).toBeInTheDocument();
    expect(screen.queryByText('Loading itinerary...')).not.toBeInTheDocument();
  });
});
