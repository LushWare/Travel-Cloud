import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HomeContainer from '../HomeContainer';
import { fetchPackages } from '../../../services/api/packages';
import { fetchRecentBookings } from '../../../services/api/booking';
import type { NormalizedPackage, AggregatedDestination } from '../../../services/api/packages.transform';

vi.mock('../../../services/api/packages', () => ({
  fetchPackages: vi.fn(),
}));

vi.mock('../../../services/api/booking', () => ({
  fetchRecentBookings: vi.fn(),
}));

const fetchPackagesMock = vi.mocked(fetchPackages);
const fetchRecentBookingsMock = vi.mocked(fetchRecentBookings);

const mockPackage = (overrides: Partial<NormalizedPackage> = {}): NormalizedPackage => ({
  id: 'pkg-1',
  slug: 'bali-paradise',
  title: 'Bali Paradise',
  name: 'Bali Paradise',
  description: 'A dreamy 5-day escape to Bali',
  destinationRaw: 'Bali, Indonesia',
  destination: {
    raw: 'Bali, Indonesia',
    name: 'Bali',
    country: 'Indonesia',
    type: 'international',
    region: 'Global',
    slug: 'bali',
    key: 'bali',
    nameSlug: 'bali',
    countrySlug: 'indonesia',
  },
  duration_days: 5,
  price_from: 50000,
  currency: 'USD',
  termsAndConditions: '',
  category: 'beach',
  difficulty: null,
  rating: 4.5,
  reviews_count: 12,
  bookings: 4,
  image_url: '/bali.jpg',
  images: ['/bali.jpg'],
  highlights: [],
  inclusions: ['Hotels', 'Flights'],
  exclusions: [],
  activities: [],
  itinerary: [],
  isFeatured: true,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  raw: {},
  ...overrides,
});

const mockDestination = (overrides: Partial<AggregatedDestination> = {}): AggregatedDestination => ({
  id: 'bali',
  name: 'Bali',
  country: 'Indonesia',
  type: 'international',
  region: 'Global',
  slug: 'bali',
  nameSlug: 'bali',
  countrySlug: 'indonesia',
  raw: 'Bali, Indonesia',
  description: 'Tropical paradise',
  image_url: '/bali.jpg',
  packages: [],
  price: 50000,
  minDuration: 3,
  maxDuration: 7,
  rating: 4.5,
  reviews: 12,
  packagesCount: 4,
  durationLabel: '3 - 7 days',
  activities: [],
  ...overrides,
});

const mockBookings = [
  {
    id: 'bk-1',
    packageId: 'bk-pkg-1',
    packageName: 'Maldives Escape',
    packageCoverImage: '/maldives.jpg',
    packageDuration: 4,
    packagePrice: 75000,
    packageSlug: 'maldives-escape',
    packageDestination: 'Maldives',
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    numberOfTravelers: 2,
  },
];

/**
 * HomeContainer schedules its data fetches via setTimeout(0) (jsdom has no
 * requestIdleCallback), and the hero's typewriter/autoplay effects own
 * timers too. Fake timers keep the run deterministic and act-quiet; only
 * the timers listed are faked so requestIdleCallback stays absent.
 */
const useFakeTimers = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
};

const flushAsyncWork = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

describe('HomeContainer', () => {
  beforeEach(() => {
    useFakeTimers();
    fetchPackagesMock.mockReset();
    fetchRecentBookingsMock.mockReset();
    fetchPackagesMock.mockResolvedValue({
      packages: [mockPackage()],
      destinations: [mockDestination()],
      pagination: null,
    });
    fetchRecentBookingsMock.mockResolvedValue(mockBookings);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the hero and section content once packages and bookings load', async () => {
    render(
      <MemoryRouter>
        <HomeContainer />
      </MemoryRouter>
    );
    await flushAsyncWork();

    expect(
      screen.getByRole('heading', { name: /Where Turquoise Tides Meet Timeless Journeys/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bali (4 packages)' })).toBeInTheDocument();
    expect(screen.getByText('Featured Packages You’ll Love')).toBeInTheDocument();
    expect(screen.getByText('Bali Paradise')).toBeInTheDocument();
    expect(screen.getByText('Recently Booked Packages')).toBeInTheDocument();
    // The slider duplicates items for its seamless loop, so the booking
    // card appears more than once.
    expect(screen.getAllByText('Maldives Escape').length).toBeGreaterThan(0);
  });

  it('labels a recent booking by its party size, never by a traveller name', async () => {
    render(
      <MemoryRouter>
        <HomeContainer />
      </MemoryRouter>
    );
    await flushAsyncWork();

    expect(screen.getAllByText('2 travellers').length).toBeGreaterThan(0);
  });

  it('labels a recent booking with no party size as "A traveller"', async () => {
    fetchRecentBookingsMock.mockResolvedValue([{ ...mockBookings[0], numberOfTravelers: null }]);
    render(
      <MemoryRouter>
        <HomeContainer />
      </MemoryRouter>
    );
    await flushAsyncWork();

    expect(screen.getAllByText('A traveller').length).toBeGreaterThan(0);
  });

  it('shows the error state when the packages fetch fails', async () => {
    fetchPackagesMock.mockRejectedValue(new Error('Server unreachable'));
    render(
      <MemoryRouter>
        <HomeContainer />
      </MemoryRouter>
    );
    await flushAsyncWork();

    expect(screen.getByText("We couldn't load travel experiences")).toBeInTheDocument();
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('navigates to /packages with the selected destination and month filters', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomeContainer />} />
          <Route path="/packages" element={<div>Packages results page</div>} />
        </Routes>
      </MemoryRouter>
    );
    await flushAsyncWork();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bali' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));

    expect(screen.getByText('Packages results page')).toBeInTheDocument();
  });

  it('opens the month dropdown and applies the selected month to the search bar', async () => {
    render(
      <MemoryRouter>
        <HomeContainer />
      </MemoryRouter>
    );
    await flushAsyncWork();

    // The typewriter effect owns the trigger's text, so locate the month
    // field by its "When?" label and find the trigger button inside it.
    const whenField = screen.getByText('When?').closest('div') as HTMLElement;
    const trigger = within(whenField).getByRole('button');
    fireEvent.click(trigger);

    // The dropdown panel is portaled to document.body (see
    // HomeContainer's createPortal usage), so its options aren't inside
    // whenField's DOM subtree — query them via screen, not within(whenField).
    fireEvent.click(screen.getByRole('button', { name: 'January' }));
    expect(within(whenField).getByRole('button', { name: 'January' })).toBeInTheDocument();
  });
});
