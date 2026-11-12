// The starting plan catalogue and who gets which plan. Prices are placeholders until pricing is
// decided; change them later in the console (that creates a new plan version, so agencies already
// on a plan keep the price they were given). Used only by scripts/seed-plans.mjs.

export const DEFAULT_PLANS = [
  {
    key: 'internal',
    name: 'Lush Internal',
    description: "Lushware's own agency. Not for sale.",
    priceMinorUnits: null,
    currency: 'USD',
    billingInterval: null,
    entitlements: { staff_seats: null, packages: null, features: { ai_itinerary_builder: true } },
  },
  {
    key: 'starter',
    name: 'Starter',
    description: 'For small agencies getting started.',
    priceMinorUnits: 4900,
    currency: 'USD',
    billingInterval: 'monthly',
    entitlements: { staff_seats: 5, packages: 25, features: { ai_itinerary_builder: false } },
  },
  {
    key: 'growth',
    name: 'Growth',
    description: 'For growing teams, with the AI itinerary builder.',
    priceMinorUnits: 14900,
    currency: 'USD',
    billingInterval: 'monthly',
    entitlements: { staff_seats: 15, packages: 100, features: { ai_itinerary_builder: true } },
  },
  {
    key: 'pro',
    name: 'Pro',
    description: 'No limits on staff or packages.',
    priceMinorUnits: 34900,
    currency: 'USD',
    billingInterval: 'monthly',
    entitlements: { staff_seats: null, packages: null, features: { ai_itinerary_builder: true } },
  },
];

// Local agencies: Lush keeps working without limits; the two test agencies cover a special deal
// (Acme) and an agency already over its limits (Globe), so both can be tried in Management.
export const DEFAULT_ASSIGNMENTS = [
  { slug: 'lush-demo', plan: 'internal', reason: "Lushware's own agency" },
  {
    slug: 'acme-tours', plan: 'growth', reason: 'Test agency on Growth',
    overrides: [{ key: 'staff_seats', value: 30, reason: 'Special deal: 30 seats for the test agency' }],
  },
  { slug: 'globe-dmc', plan: 'starter', reason: 'Test agency on Starter, over its limits on purpose' },
];
