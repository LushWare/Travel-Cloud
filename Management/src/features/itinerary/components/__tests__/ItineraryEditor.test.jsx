import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../../services/cloudinaryService', () => ({
  uploadItineraryImages: vi.fn(),
}));
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
vi.mock('../../../../services/hotel.service', () => ({ default: {
  search: vi.fn(),
  getCities: vi.fn(),
  getCountries: vi.fn().mockResolvedValue({ data: [{ code: 'LK', name: 'Sri Lanka' }, { code: 'FR', name: 'France' }] }),
} }));
vi.mock('../../hooks/usePricingDefaults', async (importOriginal) => {
  const actual = await importOriginal();
  const defaults = {
    mealPrices: { breakfast: 8, lunch: 15, dinner: 20 },
    margin: { type: 'PERCENTAGE', percentage: 20, fixed: 100 },
    transportRates: { CAR: { pricingModel: 'PER_VEHICLE', PER_VEHICLE: 50, PER_KM: 0.6 }, VAN: { pricingModel: 'PER_VEHICLE', PER_VEHICLE: 80 } },
  };
  return { ...actual, usePricingDefaults: () => ({ ...defaults, peoplePerRoom: 2, mealPricesSet: true }) };
});
vi.mock('../ActivitySelector', () => ({ default: () => <div data-testid="activity-selector" /> }));
vi.mock('../LocationSelector', () => ({ default: () => <div data-testid="location-selector" /> }));
vi.mock('../form/TransportRowEditor', () => ({ default: () => <div data-testid="transport-row-editor" /> }));
vi.mock('../../../shared', () => ({
  FlightSelectionModal: ({ onSelectTemplate }) => (
    <button
      type="button"
      onClick={() =>
        onSelectTemplate({
          origin: 'AAA',
          destination: 'BBB',
          cabinClass: 'Economy',
          departureTime: 'morning',
          airlinePreference: 'QR',
          estimatedUnitPrice: 99,
          tripType: 'roundTrip',
        })
      }
    >
      Submit Flight Leg
    </button>
  ),
  HotelSelectionModal: ({ isOpen, travelers, onSelectHotel }) => (isOpen ? (
    <button
      type="button"
      data-travelers={travelers}
      onClick={() => onSelectHotel({
        name: 'Beach Resort',
        hotelId: 'h1',
        nights: 3,
        cheapestRate: { totalAmount: 450, roomType: 'Double', boardType: 'Breakfast', currency: 'USD' },
      })}
    >
      Pick Hotel
    </button>
  ) : null),
}));

import ItineraryEditor, { pickHotelsForDays, withTransportRate, transportHint, roomsHint, fillUnpricedTransports, dayMealsAfterHotelPlan } from '../ItineraryEditor';
import { normalizePricingDefaults } from '../../hooks/usePricingDefaults';
import { uploadItineraryImages } from '../../../../services/cloudinaryService';
import HotelService from '../../../../services/hotel.service';

const baseDay = {
  dayNumber: 1,
  title: 'Arrival',
  description: 'Arrival day',
  locations: [],
  activities: [],
  transports: [],
  images: [],
};

const noop = () => {};

describe('ItineraryEditor — Day Images visibility', () => {
  // Regression coverage for the bug this fixes: EditLeadDialog passes
  // hideTitleAndDescription={true} to hide the title/description text
  // fields, but the "Day Images" upload section was accidentally nested
  // inside that same guard — hiding image upload specifically in the lead
  // editing flow even though package editing (which doesn't pass the prop)
  // showed it fine.

  it('renders the Day Images section when hideTitleAndDescription is true (the lead-editing case)', () => {
    render(
      <ItineraryEditor
        days={[baseDay]}
        onDayChange={noop}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );
    expect(screen.getByText('Day Images')).toBeInTheDocument();
    expect(screen.getByText('Upload Day Images')).toBeInTheDocument();
  });

  it('renders the Day Images section when hideTitleAndDescription is false (the package-editing case)', () => {
    render(
      <ItineraryEditor
        days={[baseDay]}
        onDayChange={noop}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription={false}
      />,
    );
    expect(screen.getByText('Day Images')).toBeInTheDocument();
  });

  it('still hides the Day Title/Description fields when hideTitleAndDescription is true (guards against over-correcting the fix)', () => {
    render(
      <ItineraryEditor
        days={[baseDay]}
        onDayChange={noop}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );
    expect(screen.queryByText('Day Title')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('e.g., Arrival in Dubai (optional)')).not.toBeInTheDocument();
  });

  it('shows the Day Title field when hideTitleAndDescription is false', () => {
    render(
      <ItineraryEditor
        days={[baseDay]}
        onDayChange={noop}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription={false}
      />,
    );
    expect(screen.getByText('Day Title')).toBeInTheDocument();
  });

  it('renders already-uploaded day images in the grid', () => {
    render(
      <ItineraryEditor
        days={[{ ...baseDay, images: [{ url: 'https://res.cloudinary.com/x/a.jpg' }] }]}
        onDayChange={noop}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );
    expect(screen.getByAltText('Day 1 Image 1')).toHaveAttribute('src', 'https://res.cloudinary.com/x/a.jpg');
  });

  it('hands the trimmed images array to onDayChange when a day image is removed', async () => {
    const onDayChange = vi.fn();
    const day = {
      ...baseDay,
      images: [
        { url: 'https://res.cloudinary.com/x/a.jpg', publicId: 'day1/a' },
        { url: 'https://res.cloudinary.com/x/b.jpg', publicId: 'day1/b' },
      ],
    };
    render(
      <ItineraryEditor
        days={[day]}
        onDayChange={onDayChange}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );

    const removeButtons = screen.getAllByTitle('Remove image');
    await userEvent.click(removeButtons[0]);

    expect(onDayChange).toHaveBeenCalledWith(1, {
      images: [{ url: 'https://res.cloudinary.com/x/b.jpg', publicId: 'day1/b' }],
    });
  });

  it('appends newly uploaded images to the existing day images on upload', async () => {
    const onDayChange = vi.fn();
    uploadItineraryImages.mockResolvedValue([{ url: 'https://res.cloudinary.com/x/new.jpg', publicId: 'day1/new' }]);
    const day = { ...baseDay, images: [{ url: 'https://res.cloudinary.com/x/a.jpg', publicId: 'day1/a' }] };

    render(
      <ItineraryEditor
        days={[day]}
        onDayChange={onDayChange}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );

    const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"][accept*="image"]');
    await userEvent.upload(input, file);

    await waitFor(() => expect(onDayChange).toHaveBeenCalledWith(1, {
      images: [
        { url: 'https://res.cloudinary.com/x/a.jpg', publicId: 'day1/a' },
        { url: 'https://res.cloudinary.com/x/new.jpg', publicId: 'day1/new' },
      ],
    }));
  });
});

describe('ItineraryEditor — compact lead-edit day navigation', () => {
  it('omits day summary chips and separates each day into focused detail tabs', async () => {
    const user = userEvent.setup();
    render(
      <ItineraryEditor
        days={[
          {
            ...baseDay,
            title: 'Arrival in Sri Lanka',
            locations: ['Colombo', 'Kandy', 'Ella'],
            activities: [{ name: 'City walk' }],
            flights: [{ id: 'flight-1' }],
            accommodation: { name: 'Hilltop Hotel' },
          },
          { ...baseDay, dayNumber: 2, title: 'Hill Country', locations: ['Nuwara Eliya'] },
        ]}
        onDayChange={noop}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
        compactDayNavigation
      />,
    );

    expect(screen.getAllByText('Arrival in Sri Lanka').length).toBeGreaterThan(0);
    expect(screen.queryByText('Colombo · Kandy +1')).not.toBeInTheDocument();
    expect(screen.queryByText('Hilltop Hotel')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Plan/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Flight Booking')).not.toBeInTheDocument();

    const dayOne = screen.getByRole('tab', { name: /Day 1: Arrival in Sri Lanka/ });
    const dayTwo = screen.getByRole('tab', { name: /Day 2: Hill Country/ });
    expect(dayOne).not.toHaveTextContent('Colombo · Kandy');
    expect(dayOne).toHaveAttribute('aria-selected', 'true');
    expect(dayTwo).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText('Day 2 details')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Flights & stay/ }));
    expect(screen.getByText('Flight Booking')).toBeInTheDocument();
    expect(screen.queryByText('Locations Covered')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Notes & photos/ }));
    expect(screen.getByText('Day Images')).toBeInTheDocument();
    expect(screen.queryByText('Flight Booking')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Costs/ }));
    expect(screen.getByText('Costs & Pricing')).toBeInTheDocument();
    expect(screen.getByText('Breakfasts')).toBeInTheDocument();
    expect(screen.getByText('City walk')).toBeInTheDocument();
    expect(screen.queryByText('(collapsed)')).not.toBeInTheDocument();

    await user.click(dayTwo);
    expect(dayOne).toHaveAttribute('aria-selected', 'false');
    expect(dayTwo).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Plan/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Colombo · Kandy +1')).not.toBeInTheDocument();
  });
});

describe('ItineraryEditor — meal prices', () => {
  const renderCosts = async (day, onDayChange = noop) => {
    render(
      <ItineraryEditor days={[{ ...baseDay, ...day }]} onDayChange={onDayChange} onAddDay={noop} onRemoveDay={noop} hideTitleAndDescription compactDayNavigation />,
    );
    await userEvent.click(screen.getByRole('tab', { name: /^Costs/ }));
  };

  it('shows each meal Settings price as the placeholder', async () => {
    await renderCosts({});
    expect(document.getElementById('day-1-dinnerPriceOverride')).toHaveAttribute('placeholder', '20');
  });

  it('saves a price typed for one meal on that meal only', async () => {
    const onDayChange = vi.fn();
    await renderCosts({}, onDayChange);

    await userEvent.type(document.getElementById('day-1-dinnerPriceOverride'), '4');

    expect(onDayChange).toHaveBeenLastCalledWith(1, { dinnerPriceOverride: 4 });
  });

  it('keeps an old single day price on the other meals when one meal price changes', async () => {
    const onDayChange = vi.fn();
    await renderCosts({ mealPriceOverride: 12 }, onDayChange);

    await userEvent.clear(document.getElementById('day-1-breakfastPriceOverride'));

    expect(onDayChange).toHaveBeenLastCalledWith(1, {
      breakfastPriceOverride: null, lunchPriceOverride: 12, dinnerPriceOverride: 12, mealPriceOverride: null,
    });
  });

  it('totals the day meals at each meal own price', async () => {
    await renderCosts({ breakfastCount: 1, lunchCount: 0, dinnerCount: 1 });
    expect(screen.getByText(/1 × \$\s?8 \+ 1 × \$\s?20 =/)).toBeInTheDocument();
  });
});

describe('unpriced transport on package edit', () => {
  const defaults = normalizePricingDefaults({ transportRates: { CAR: { pricingModel: 'PER_VEHICLE', PER_VEHICLE: 50, PER_KM: 0.6 } } });

  it('gives an unpriced car row the Settings rate for its pricing model', () => {
    const rows = fillUnpricedTransports([{ transportMode: 'CAR', pricingModel: 'PER_KM', unitCost: 0, distanceKm: 40 }], defaults);
    expect(rows[0]).toMatchObject({ pricingModel: 'PER_KM', unitCost: 0.6, distanceKm: 40 });
  });

  it('uses the vehicle default rate when its own pricing model has none', () => {
    const rows = fillUnpricedTransports([{ transportMode: 'CAR', pricingModel: 'PER_PERSON', unitCost: 0 }], defaults);
    expect(rows[0]).toMatchObject({ pricingModel: 'PER_VEHICLE', unitCost: 50 });
  });

  it('leaves a priced row and a flight alone', () => {
    const rows = [{ transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 65 }, { transportMode: 'FLIGHT', pricingModel: 'PER_PERSON', unitCost: 0 }];
    expect(fillUnpricedTransports(rows, defaults)).toBeNull();
  });

  it('fills unpriced rows when a package opens for editing', async () => {
    const onDayChange = vi.fn();
    render(
      <ItineraryEditor
        days={[{ ...baseDay, transports: [{ transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 0 }] }]}
        onDayChange={onDayChange} onAddDay={noop} onRemoveDay={noop} fillUnpricedTransport
      />,
    );
    await waitFor(() => expect(onDayChange).toHaveBeenCalledWith(1, { transports: [expect.objectContaining({ unitCost: 50 })] }));
  });

  it('does not change a lead itinerary on open', async () => {
    const onDayChange = vi.fn();
    render(
      <ItineraryEditor
        days={[{ ...baseDay, transports: [{ transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 0 }] }]}
        onDayChange={onDayChange} onAddDay={noop} onRemoveDay={noop} travelers={3}
      />,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(onDayChange).not.toHaveBeenCalledWith(1, expect.objectContaining({ transports: expect.anything() }));
  });
});

describe('transport and room hints', () => {
  const defaults = normalizePricingDefaults({ transportRates: { CAR: { pricingModel: 'PER_VEHICLE', seats: 4 } }, peoplePerRoom: 2 });
  const car = { transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 50 };

  it('shows the seats of a package vehicle', () => {
    expect(transportHint(car, defaults)).toBe('Car seats 4');
  });

  it('shows how many cars a lead group needs and what they cost', () => {
    expect(transportHint(car, defaults, 5)).toMatch(/^Car seats 4 · 5 travellers → 2 cars × \$\s?50 = \$\s?100$/);
  });

  it('shows no seats for a vehicle without seats in Settings', () => {
    expect(transportHint({ ...car, transportMode: 'VAN' }, defaults)).toBeNull();
  });

  it('shows nothing for a flight', () => {
    expect(transportHint({ transportMode: 'FLIGHT', pricingModel: 'PER_PERSON', unitCost: 300 }, defaults, 3)).toBeNull();
  });

  it('shows the rooms a lead group needs', () => {
    expect(roomsHint({ name: 'Beach Resort' }, defaults, 3)).toBe('3 travellers → 2 rooms (2 per room)');
  });

  it('shows no rooms when the hotel price covers the whole party', () => {
    expect(roomsHint({ name: 'Beach Resort', priceCovers: 'PARTY' }, defaults, 3)).toBeNull();
  });
});

describe('meals covered by the hotel meal plan', () => {
  const halfBoard = { name: 'Zhiwaling Heritage', totalAmount: 916.66, boardType: 'Half Board' };
  const days = [
    { ...baseDay, dayNumber: 1, breakfastCount: 0, lunchCount: 1, dinnerCount: 1, accommodation: halfBoard },
    { ...baseDay, dayNumber: 2, breakfastCount: 1, lunchCount: 1, dinnerCount: 0, accommodation: {} },
  ];

  it('does not charge the dinner a half-board hotel includes', () => {
    expect(dayMealsAfterHotelPlan(days, 1)).toMatchObject({ lunchCount: 1, dinnerCount: 0, includedMeals: { dinner: 1 } });
  });

  it('does not charge next morning breakfast at the same hotel', () => {
    expect(dayMealsAfterHotelPlan(days, 2)).toMatchObject({ breakfastCount: 0, lunchCount: 1, includedMeals: { breakfast: 1 } });
  });

  it('shows only the charged lunch in the day meal total', async () => {
    render(<ItineraryEditor days={days} onDayChange={noop} onAddDay={noop} onRemoveDay={noop} hideTitleAndDescription compactDayNavigation />);
    await userEvent.click(screen.getByRole('tab', { name: /^Costs/ }));
    expect(screen.getByText(/dinner in hotel meal plan/)).toBeInTheDocument();
    expect(screen.getByText(/^Meals:/)).toHaveTextContent(/Meals: \$\s?15$/);
  });
});

describe('withTransportRate', () => {
  const defaults = { transportRates: { CAR: { pricingModel: 'PER_VEHICLE', PER_VEHICLE: 50, PER_KM: 0.6 }, VAN: { pricingModel: 'PER_VEHICLE', PER_VEHICLE: 80 } } };

  it('starts a new car row at the Settings car rate', () => {
    expect(withTransportRate(null, { transportMode: 'CAR', pricingModel: 'PER_KM', unitCost: 0 }, defaults))
      .toMatchObject({ pricingModel: 'PER_VEHICLE', unitCost: 50 });
  });

  it('moves an untouched row to the new mode rate', () => {
    const car = { transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 50 };
    expect(withTransportRate(car, { ...car, transportMode: 'VAN' }, defaults).unitCost).toBe(80);
  });

  it('loads the Settings rate when the vehicle changes, replacing the old cost', () => {
    const car = { transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 6.6 };
    expect(withTransportRate(car, { ...car, transportMode: 'VAN' }, defaults).unitCost).toBe(80);
  });

  it('brings up the per km rate when an untouched car switches to per km', () => {
    const car = { transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 50 };
    expect(withTransportRate(car, { ...car, pricingModel: 'PER_KM' }, defaults).unitCost).toBe(0.6);
  });

  it('clears a Settings price instead of carrying it to a pricing model without a rate', () => {
    const car = { transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 50 };
    expect(withTransportRate(car, { ...car, pricingModel: 'PER_PERSON' }, defaults).unitCost).toBe(0);
  });

  it('loads the Settings rate when the pricing model changes, replacing the old cost', () => {
    const car = { transportMode: 'CAR', pricingModel: 'PER_VEHICLE', unitCost: 65 };
    expect(withTransportRate(car, { ...car, pricingModel: 'PER_KM' }, defaults).unitCost).toBe(0.6);
  });

  it('leaves a mode without a Settings rate at its own cost', () => {
    expect(withTransportRate(null, { transportMode: 'BOAT', pricingModel: 'PER_PERSON', unitCost: 0 }, defaults).unitCost).toBe(0);
  });
});

describe('ItineraryEditor — meal toggles', () => {
  // Regression: the visually-hidden checkbox is `sr-only` (position:absolute).
  // With no positioned ancestor it was placed against the dialog shell, and
  // focusing it on click scrolled the whole Edit Lead dialog out of view.
  it('anchors each hidden meal checkbox inside a positioned chip', () => {
    render(
      <ItineraryEditor
        days={[baseDay]}
        onDayChange={noop}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );

    const breakfast = screen.getByRole('checkbox', { name: 'Breakfast' });
    expect(breakfast).toHaveClass('sr-only');
    expect(breakfast.closest('label')).toHaveClass('relative');
  });

  it('turns breakfast on with a count of 1 when its chip is clicked', async () => {
    const onDayChange = vi.fn();
    render(
      <ItineraryEditor
        days={[baseDay]}
        onDayChange={onDayChange}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );

    await userEvent.click(screen.getByText('Breakfast'));

    expect(onDayChange).toHaveBeenCalledWith(1, { meals: { breakfast: true }, breakfastCount: 1 });
  });
});

describe('ItineraryEditor — hotel price', () => {
  const renderAndOpenHotelSearch = async (onDayChange = noop) => {
    render(
      <ItineraryEditor
        days={[baseDay]}
        onDayChange={onDayChange}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /search hotels/i }));
  };

  it('searches hotel rates for a twin-sharing room of 2 adults', async () => {
    await renderAndOpenHotelSearch();

    expect(screen.getByRole('button', { name: 'Pick Hotel' })).toHaveAttribute('data-travelers', '2');
  });

  it('stores the per-night room price when the searched stay covers several nights', async () => {
    const onDayChange = vi.fn();
    await renderAndOpenHotelSearch(onDayChange);

    await userEvent.click(screen.getByRole('button', { name: 'Pick Hotel' }));

    expect(onDayChange.mock.calls[0][1].accommodation.totalAmount).toBe(150);
  });

  it('auto-fills a day with a real provider hotel including its id, image and room price', async () => {
    HotelService.getCities.mockResolvedValue({ data: ['Maafushi', 'Male'] });
    HotelService.search.mockResolvedValue({
      data: [{
        hotelId: 'lp123',
        name: 'Kaani Grand Seaview',
        address: 'Maafushi',
        rating: 8.6,
        images: ['https://img/kaani.jpg'],
        cheapestRate: { totalAmount: 120, roomType: 'Deluxe Double', boardType: 'Breakfast Included', currency: 'USD' },
      }],
    });
    const onDayChange = vi.fn();
    render(
      <ItineraryEditor
        days={[{ ...baseDay, locations: ['Maafushi'] }]}
        destination="Maldives"
        onDayChange={onDayChange}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );

    await waitFor(() => expect(onDayChange).toHaveBeenCalled(), { timeout: 3000 });

    expect(onDayChange.mock.calls[0][1].accommodation).toMatchObject({
      hotelId: 'lp123',
      hotelImage: 'https://img/kaani.jpg',
      roomType: 'Deluxe Double',
      totalAmount: 120,
    });
  });
});

describe('pickHotelsForDays', () => {
  const hotelIn = (city) => ({ hotelId: `h-${city}`, name: `${city} Hotel`, cheapestRate: { totalAmount: 100 } });

  it('uses the hotel of the location covered that day', async () => {
    HotelService.getCities.mockResolvedValue({ data: ['Colombo', 'Kandy'] });
    HotelService.search.mockImplementation(async ({ city }) => ({ data: [hotelIn(city)] }));

    const picks = await pickHotelsForDays([
      { dayNumber: 1, locations: ['Colombo'] },
      { dayNumber: 2, locations: ['Kandy City Centre'] },
    ], 'Sri Lanka');

    expect(picks.get(2).hotelId).toBe('h-Kandy');
  });

  it('keeps the previous day hotel when a day location has no provider hotels', async () => {
    HotelService.getCities.mockResolvedValue({ data: ['Ubud', 'Kuta'] });
    HotelService.search.mockImplementation(async ({ city }) => ({ data: city === 'Ubud' ? [hotelIn(city)] : [] }));

    const picks = await pickHotelsForDays([
      { dayNumber: 1, locations: ['Ubud'] },
      { dayNumber: 2, locations: ['Kuta'] },
    ], 'Bali');

    expect(picks.get(2).hotelId).toBe('h-Ubud');
  });

  it('gives a day without locations the first hotel of the package', async () => {
    HotelService.getCities.mockResolvedValue({ data: ['Hanoi'] });
    HotelService.search.mockImplementation(async ({ city }) => ({ data: [hotelIn(city)] }));

    const picks = await pickHotelsForDays([
      { dayNumber: 1, locations: [] },
      { dayNumber: 2, locations: ['Hanoi'] },
    ], 'Vietnam');

    expect(picks.get(1).hotelId).toBe('h-Hanoi');
  });

  it('leaves a day that already has a hotel unchanged', async () => {
    HotelService.getCities.mockResolvedValue({ data: ['Paris'] });
    HotelService.search.mockImplementation(async ({ city }) => ({ data: [hotelIn(city)] }));

    const picks = await pickHotelsForDays([
      { dayNumber: 1, locations: ['Paris'], accommodation: { name: 'Chosen Hotel' } },
    ], 'France');

    expect(picks.has(1)).toBe(false);
  });
});

describe('ItineraryEditor — day flights stay single-leg', () => {
  it('never writes a submitted tripType into the day flight', async () => {
    const onDayChange = vi.fn();
    render(
      <ItineraryEditor
        days={[{ ...baseDay, flights: [{ id: 'f1', origin: 'CMB', destination: 'DXB' }] }]}
        onDayChange={onDayChange}
        onAddDay={noop}
        onRemoveDay={noop}
        hideTitleAndDescription
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /edit flight/i }));
    await userEvent.click(screen.getByRole('button', { name: /submit flight leg/i }));

    expect(onDayChange).toHaveBeenCalledTimes(1);
    const [dayNumber, patch] = onDayChange.mock.calls[0];
    expect(dayNumber).toBe(1);
    expect(patch.flights[0]).not.toHaveProperty('tripType');
    expect(patch.flights[0].origin).toBe('AAA');
  });
});

describe('TransportRowEditor price label', () => {
  const renderRow = async (pricingModel) => {
    const { default: TransportRowEditor } = await vi.importActual('../form/TransportRowEditor');
    render(<TransportRowEditor index={0} transport={{ transportMode: 'CAR', pricingModel, unitCost: 65 }} onChange={noop} onRemove={noop} />);
  };

  it('names the price per vehicle for per-vehicle pricing', async () => {
    await renderRow('PER_VEHICLE');
    expect(screen.getByLabelText('Price per vehicle')).toHaveValue(65);
  });

  it('names the price per km for per-km pricing', async () => {
    await renderRow('PER_KM');
    expect(screen.getByLabelText('Price per km')).toBeInTheDocument();
  });

  it('names the price per person for per-person pricing', async () => {
    await renderRow('PER_PERSON');
    expect(screen.getByLabelText('Price per person')).toBeInTheDocument();
  });
});
