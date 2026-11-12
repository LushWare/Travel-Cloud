// The starting plan catalogue and who gets which plan. Prices are placeholders until pricing is
// decided; change them later in the console (that creates a new plan version, so agencies already
// on a plan keep the price they were given). Used only by scripts/seed-plans.mjs.

const ALL_FEATURES = Object.freeze({
  ai_itinerary_builder: true, finance_docs: true, whatsapp: true, vendors: true,
  travel_booking: true, analytics_full: true,
});

export const DEFAULT_PLANS = [
  {
    key: 'internal',
    name: 'Lush Internal',
    description: "Lushware's own agency. Not for sale.",
    priceMinorUnits: null,
    currency: 'USD',
    billingInterval: null,
    entitlements: { staff_seats: null, packages: null, features: ALL_FEATURES },
  },
  {
    key: 'starter',
    name: 'Starter',
    description: 'For small agencies getting started.',
    priceMinorUnits: 4900,
    currency: 'USD',
    billingInterval: 'monthly',
    // Leads, packages and quotations only: the modules are what the higher plans add.
    entitlements: {
      staff_seats: 5,
      packages: 25,
      emails_per_month: 1000,
      // WhatsApp is not in Starter at all (features.whatsapp is false), so no allowance is needed.
      whatsapp_per_month: null,
      features: {
        ai_itinerary_builder: false, finance_docs: false, whatsapp: false, vendors: false,
        travel_booking: false, analytics_full: false,
      },
    },
  },
  {
    key: 'growth',
    name: 'Growth',
    description: 'For growing teams, with the AI itinerary builder.',
    priceMinorUnits: 14900,
    currency: 'USD',
    billingInterval: 'monthly',
    entitlements: { staff_seats: 15, packages: 100, emails_per_month: 5000, whatsapp_per_month: 2000, features: { ...ALL_FEATURES, travel_booking: false } },
  },
  {
    key: 'pro',
    name: 'Pro',
    description: 'No limits on staff or packages.',
    priceMinorUnits: 34900,
    currency: 'USD',
    billingInterval: 'monthly',
    entitlements: { staff_seats: null, packages: null, emails_per_month: 20000, whatsapp_per_month: 10000, features: ALL_FEATURES },
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
