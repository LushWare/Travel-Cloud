import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { mockSearch, mockBook, mockGetCheckoutData, mockListBookings, mockCancelBooking } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockBook: vi.fn(),
  mockGetCheckoutData: vi.fn(),
  mockListBookings: vi.fn(),
  mockCancelBooking: vi.fn(),
}));

vi.mock('../../services/flight.service', () => ({
  flightAPI: {
    search: mockSearch,
    book: mockBook,
    getCheckoutData: mockGetCheckoutData,
    listBookings: mockListBookings,
    cancelBooking: mockCancelBooking,
  },
}));

// Stub the shared API client so this page test only exercises the flight service.
vi.mock('../../services/api', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1',
  default: {},
}));

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import FlightSearch from '../FlightSearch';

function renderFlightSearch(initialEntry = '/flights') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <FlightSearch />
    </MemoryRouter>,
  );
}

// Every case here mounts the whole page and drives it through Base UI controls,
// which is slow enough on a loaded runner to trip vitest's 5s default.
vi.setConfig({ testTimeout: 20_000 });

const seg = (origin, destination, departureAt, arrivalAt, durationMinutes, sequence) => ({
  origin,
  destination,
  departureAt,
  arrivalAt,
  durationMinutes,
  sequence,
});

const oneWayOffer = (index, segmentCount = 1) => {
  const stops = ['DXB', 'IST', 'CAI', 'AMM'];
  const segments = [];
  let origin = 'LHR';
  for (let i = 0; i < segmentCount; i++) {
    const destination = stops[i % stops.length];
    segments.push(seg(origin, destination, `2026-09-20T0${i + 8}:00:00Z`, `2026-09-20T1${i}:00:00Z`, 180, i + 1));
    origin = destination;
  }
  return {
    offerId: `off-ow-${index}`,
    airline: `Airline ${index}`,
    airlineCode: `A${index % 10}`,
    cabinClass: 'Economy',
    fareTotal: 200 + index,
    currency: 'USD',
    legCount: 1,
    passengerIds: [`pas_ow_${index}`],
    segments,
  };
};

const NONSTOP_ROUND_TRIP = {
  offerId: 'off-rt-nonstop',
  airline: 'Emirates',
  airlineCode: 'EK',
  cabinClass: 'Economy',
  fareTotal: 620,
  currency: 'USD',
  legCount: 2,
  passengerIds: ['pas_rt_1'],
  segments: [
    seg('LHR', 'DXB', '2026-09-20T08:00:00Z', '2026-09-20T15:00:00Z', 420, 1),
    seg('DXB', 'LHR', '2026-09-27T08:00:00Z', '2026-09-27T15:10:00Z', 430, 101),
  ],
};

const CONNECTING_ROUND_TRIP = {
  offerId: 'off-rt-connecting',
  airline: 'Turkish Airlines',
  airlineCode: 'TK',
  cabinClass: 'Economy',
  fareTotal: 700,
  currency: 'USD',
  legCount: 2,
  passengerIds: ['pas_rt_2'],
  segments: [
    seg('LHR', 'IST', '2026-09-20T08:00:00Z', '2026-09-20T12:00:00Z', 240, 1),
    seg('IST', 'DXB', '2026-09-20T13:00:00Z', '2026-09-20T18:00:00Z', 300, 2),
    seg('DXB', 'AMS', '2026-09-27T08:00:00Z', '2026-09-27T10:00:00Z', 120, 101),
    seg('AMS', 'LHR', '2026-09-27T11:00:00Z', '2026-09-27T13:00:00Z', 120, 102),
  ],
};

const booking = (index, status) => ({
  id: `booking-${index}`,
  pnr: `PNR-${index}`,
  status,
  segments: [seg('CMB', 'DXB', '2026-09-20T08:00:00Z')],
  travelers: [{ type: 'adult', firstName: 'John', lastName: 'Doe' }],
  totalAmount: 300,
  currency: 'USD',
});

async function pickAirport(user, input, query, code) {
  await user.type(input, query);
  const options = await screen.findAllByRole('button', { name: new RegExp(code) });
  await user.click(options[0]);
}

async function searchLhrToDxb(user) {
  const [fromInput, toInput] = screen.getAllByPlaceholderText('City or airport');
  await pickAirport(user, fromInput, 'London', 'LHR');
  await pickAirport(user, toInput, 'Dubai', 'DXB');
  await user.click(screen.getByRole('button', { name: /Search Flights/ }));
  await waitFor(() => expect(mockSearch).toHaveBeenCalled());
}

function dateInFuture(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function setDates(user, departureDate, returnDate) {
  await user.click(screen.getByRole('tab', { name: 'Round Trip' }));
  const dateInputs = document.querySelectorAll('input[type="date"]');
  fireEvent.change(dateInputs[0], { target: { value: departureDate } });
  fireEvent.change(dateInputs[1], { target: { value: returnDate } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBook.mockResolvedValue({ data: { pnr: 'MOCKPNR' } });
  mockListBookings.mockResolvedValue({ data: [] });
});

describe('FlightSearch results', () => {
  it('renders one page of offers and grows the list on request', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: Array.from({ length: 45 }, (_, i) => oneWayOffer(i + 1)) });
    renderFlightSearch();

    await searchLhrToDxb(user);

    expect(screen.getAllByRole('button', { name: 'Select' })).toHaveLength(20);
    expect(screen.getByText('Showing 20 of 45 flights')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 20 more flights' }));
    expect(screen.getAllByRole('button', { name: 'Select' })).toHaveLength(40);

    await user.click(screen.getByRole('button', { name: 'Show 5 more flights' }));
    expect(screen.getAllByRole('button', { name: 'Select' })).toHaveLength(45);
    expect(screen.queryByText(/Showing \d+ of \d+ flights/)).toBeNull();
  });

  it('treats the 2+ Stops pill as at least two stops', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: [oneWayOffer(1), oneWayOffer(2, 3)] });
    renderFlightSearch();

    await searchLhrToDxb(user);
    expect(screen.getByText('2 flights found')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(screen.getByRole('button', { name: '2+ Stops' }));

    expect(screen.getByText('1 flight found')).toBeInTheDocument();
    expect(screen.getByText('2 stops')).toBeInTheDocument();
  });

  it('labels each leg of a round trip and filters on the journey total', async () => {
    const user = userEvent.setup();
    const departureDate = dateInFuture(30);
    const returnDate = dateInFuture(37);
    mockSearch.mockResolvedValue({ data: [NONSTOP_ROUND_TRIP, CONNECTING_ROUND_TRIP] });
    renderFlightSearch();

    await setDates(user, departureDate, returnDate);
    await searchLhrToDxb(user);
    expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({ tripType: 'roundTrip', returnDate }));

    // 1 + 1 slices: both legs nonstop; 2 + 2 slices: one connection each way.
    expect(screen.getAllByText('Nonstop')).toHaveLength(2);
    expect(screen.getAllByText('1 stop')).toHaveLength(2);
    expect(screen.getByText('Direct')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(screen.getByRole('button', { name: '2+ Stops' }));

    expect(screen.getByText('1 flight found')).toBeInTheDocument();
    expect(screen.getByText('Turkish Airlines')).toBeInTheDocument();
  });
});

describe('FlightSearch booking', () => {
  it('books with the searched context and the offer’s passenger ids', async () => {
    const user = userEvent.setup();
    mockSearch.mockResolvedValue({ data: [NONSTOP_ROUND_TRIP] });
    mockGetCheckoutData.mockResolvedValue({
      data: {
        offer: {
          id: NONSTOP_ROUND_TRIP.offerId,
          owner: { name: 'Emirates', iata_code: 'EK' },
          base_amount: '500',
          tax_amount: '120',
          total_amount: '620',
          total_currency: 'USD',
          conditions: { refund_before_departure: { allowed: false } },
          slices: [{
            segments: [{
              origin: { iata_code: 'LHR' },
              destination: { iata_code: 'DXB' },
              departing_at: '2026-09-20T08:00:00Z',
              arriving_at: '2026-09-20T15:00:00Z',
              marketing_carrier: { iata_code: 'EK', name: 'Emirates' },
              marketing_carrier_flight_number: '1',
              operating_carrier: { name: 'Emirates' },
            }],
          }, {
            segments: [{
              origin: { iata_code: 'DXB' },
              destination: { iata_code: 'LHR' },
              departing_at: '2026-09-27T08:00:00Z',
              arriving_at: '2026-09-27T15:10:00Z',
              marketing_carrier: { iata_code: 'EK', name: 'Emirates' },
              marketing_carrier_flight_number: '2',
              operating_carrier: { name: 'Emirates' },
            }],
          }],
          passengers: [{ id: 'pas_rt_1' }],
        },
        seatMaps: [],
        upsellOffers: [],
        clientKey: '',
        cardCheckoutEnabled: false,
      },
    });
    renderFlightSearch();

    await setDates(user, dateInFuture(30), dateInFuture(37));
    await searchLhrToDxb(user);

    // The trip type is switched back to one-way after the search. It may not
    // change what is booked off the round trip that produced these results.
    await user.click(screen.getByRole('tab', { name: 'One Way' }));
    await user.click(screen.getByRole('button', { name: 'Select' }));

    await user.type(screen.getByPlaceholderText('First name *'), 'John');
    await user.type(screen.getByPlaceholderText('Last name *'), 'Doe');
    await user.type(screen.getByTitle('Date of birth'), '1990-01-01');
    await user.type(screen.getByPlaceholderText('Passenger email *'), 'john@test.com');
    await user.type(screen.getByPlaceholderText('+442079460018'), '+442079460018');
    await user.type(screen.getByPlaceholderText('Email *'), 'john@test.com');

    const genderTrigger = screen.getAllByRole('combobox')[1];
    await user.click(genderTrigger);
    await user.click(await screen.findByRole('option', { name: 'Male' }));

    await user.click(screen.getByRole('button', { name: /Review Booking/ }));
    await user.click(screen.getByRole('button', { name: /Review and pay/i }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Book using Duffel balance/i }));

    await waitFor(() => expect(mockBook).toHaveBeenCalled());
    const payload = mockBook.mock.calls[0][0];
    expect(payload.tripType).toBe('roundTrip');
    expect(payload.travelers).toHaveLength(1);
    expect(payload.travelers[0].passengerId).toBe('pas_rt_1');
    expect(payload.travelers[0].type).toBe('adult');
    expect(payload.travelers[0].dob).toBe('1990-01-01');
    // Untouched optional fields are empty strings in the form; the API's schema
    // rejects those, so they must not be sent at all.
    expect(payload.travelers[0]).not.toHaveProperty('nationality');
  });
});

describe('FlightSearch bookings list', () => {
  it('opens only recommendation-linked bookings and can clear the filter', async () => {
    const user = userEvent.setup();
    mockListBookings.mockResolvedValue({ data: [booking(1, 'confirmed'), booking(2, 'pending')] });
    renderFlightSearch('/flights?tab=bookings&ids=booking-2&focus=recommendation');

    expect(await screen.findByText('PNR-2')).toBeInTheDocument();
    expect(screen.queryByText('PNR-1')).not.toBeInTheDocument();
    expect(screen.getByText('Active filter: linked flight bookings')).toHaveTextContent('(1)');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Confirmed/ })).toHaveTextContent('0');

    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(await screen.findByText('PNR-1')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Search & Book/ }));
    expect(screen.queryByText(/Active filter: linked flight bookings/)).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Manage Bookings/ })).not.toHaveAttribute('aria-selected', 'true');
  });

  it('counts bookings by status bucket', async () => {
    const user = userEvent.setup();
    mockListBookings.mockResolvedValue({
      data: [booking(1, 'confirmed'), booking(2, 'confirmed'), booking(3, 'failed'), booking(4, 'pending'), booking(5, 'cancelled')],
    });
    renderFlightSearch();

    await user.click(screen.getByRole('tab', { name: /Manage Bookings/ }));

    await screen.findByText('PNR-1');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('5');
    expect(screen.getByRole('tab', { name: /Confirmed/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Pending/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Cancelled/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Failed/ })).toHaveTextContent('1');
  });
});
