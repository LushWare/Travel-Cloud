/**
 * Unified seed script for all Travel CRM microservice schemas.
 * Run from the Services/ directory:  node seed.mjs
 *
 * Insertion order respects cross-schema UUID dependencies:
 *   crm_users → crm_packages → crm_leads → crm_bookings
 *               → crm_billing → crm_careers → crm_auth
 */

import { PrismaClient as AuthClient }    from './auth-service/node_modules/@prisma/client/index.js';
import { PrismaClient as UserClient }    from './user-service/node_modules/@prisma/client/index.js';
import { PrismaClient as PkgClient }     from './package-service/node_modules/@prisma/client/index.js';
import { PrismaClient as LeadClient }    from './lead-service/node_modules/@prisma/client/index.js';
import { PrismaClient as BookClient }    from './booking-service/node_modules/@prisma/client/index.js';
import { PrismaClient as BillClient }    from './billing-service/node_modules/@prisma/client/index.js';
import { PrismaClient as CareerClient }  from './career-service/node_modules/@prisma/client/index.js';
import { requireDatabaseUrl } from './database-url.mjs';

const DB_URL     = requireDatabaseUrl('seed.mjs');

const opts = { datasources: { db: { url: DB_URL } } };

const auth   = new AuthClient(opts);
const users  = new UserClient(opts);
const pkg    = new PkgClient(opts);
const leads  = new LeadClient(opts);
const books  = new BookClient(opts);
const bill   = new BillClient(opts);
const career = new CareerClient(opts);

// ─── Fixed UUIDs so cross-schema refs are consistent ──────────
const ID = {
  superAdmin:  'a0000000-0000-0000-0000-000000000001',
  admin:       'a0000000-0000-0000-0000-000000000002',
  salesRep1:   'a0000000-0000-0000-0000-000000000003',
  salesRep2:   'a0000000-0000-0000-0000-000000000004',
  customer1:   'a0000000-0000-0000-0000-000000000005',
  customer2:   'a0000000-0000-0000-0000-000000000006',
  vendor1:     'a0000000-0000-0000-0000-000000000007',
  pkg1:        'b0000000-0000-0000-0000-000000000001',
  pkg2:        'b0000000-0000-0000-0000-000000000002',
  pkg3:        'b0000000-0000-0000-0000-000000000003',
  itin1:       'c0000000-0000-0000-0000-000000000001',
  itin2:       'c0000000-0000-0000-0000-000000000002',
  lead1:       'd0000000-0000-0000-0000-000000000001',
  lead2:       'd0000000-0000-0000-0000-000000000002',
  lead3:       'd0000000-0000-0000-0000-000000000003',
  booking1:    'e0000000-0000-0000-0000-000000000001',
  booking2:    'e0000000-0000-0000-0000-000000000002',
  invoice1:    'f0000000-0000-0000-0000-000000000001',
  invoice2:    'f0000000-0000-0000-0000-000000000002',
  quotation1:  'f0000000-0000-0000-0000-000000000003',
  receipt1:    'f0000000-0000-0000-0000-000000000004',
  vacancy1:    'g0000000-0000-0000-0000-000000000001',
  vacancy2:    'g0000000-0000-0000-0000-000000000002',
};

async function seedUsers() {
  console.log('  → crm_users');

  const userData = [
    {
      id: ID.superAdmin,
      name: 'Super Admin',
      email: 'superadmin@travelcrm.com',
      password: '$2a$12$Xi1YLm4QkBk/OyoDEHPA9.6L/NeunWNVOsA58lEcShfVD5qsRyRKq',
      role: 'superAdmin',
      isSuperAdmin: true,
      canBeDeleted: false,
      permissions: ['manage_users','manage_sales_reps','manage_vendors','manage_admins','view_reports','manage_billing','view_billing','manage_leads','manage_packages'],
      isActive: true,
      isEmailVerified: true,
    },
    {
      id: ID.admin,
      name: 'Alice Admin',
      email: 'alice.admin@travelcrm.com',
      password: '$2a$12$O.a/C.8AAc6yeD0MV3mcaeNOIKN81mLD2zIsYe0hqyP8sx3gkktjW',
      role: 'admin',
      permissions: ['manage_users','manage_leads','manage_packages','view_reports','manage_billing','view_billing'],
      isActive: true,
      isEmailVerified: true,
      createdById: ID.superAdmin,
    },
    {
      id: ID.salesRep1,
      name: 'Bob Sales',
      email: 'bob.sales@travelcrm.com',
      password: '$2a$12$oQX54f0pa4V81sQNFqJLWetAagB/9wMvygRKpvD4qBcMo4toGEDqq',
      role: 'salesRep',
      permissions: ['manage_leads','view_billing'],
      isActive: true,
      isEmailVerified: true,
      createdById: ID.admin,
      lastActivity: new Date(),
    },
    {
      id: ID.salesRep2,
      name: 'Carol Sales',
      email: 'carol.sales@travelcrm.com',
      password: '$2a$12$bUZGRR4LykU/9xmSmK8Vs.r1inQhb4ptt1TOMTgXk.ClNBdi7SPJC',
      role: 'salesRep',
      permissions: ['manage_leads','view_billing'],
      isActive: true,
      isEmailVerified: true,
      createdById: ID.admin,
    },
    {
      id: ID.customer1,
      name: 'David Kumar',
      email: 'david.kumar@gmail.com',
      password: '$2a$12$kwEl/NaVh29KGGe/AwBrkORMtiJaTSZyzMjmGB0UV2imm834gV.v.',
      phone: '+94771234567',
      phoneCountry: 'LK',
      role: 'customer',
      isActive: true,
      isEmailVerified: true,
    },
    {
      id: ID.customer2,
      name: 'Emily Chen',
      email: 'emily.chen@gmail.com',
      password: '$2a$12$SblmquJzZb3NKnZtvnI8aenDluSoAKlB0jofQ9bWXgtJ8hSmKTjD.',
      phone: '+6591234567',
      phoneCountry: 'SG',
      role: 'customer',
      isActive: true,
      isEmailVerified: false,
    },
    {
      id: ID.vendor1,
      name: 'Saman Perera',
      email: 'saman@ceylonhotels.lk',
      password: '$2a$12$TgQriWbNsY8FviT/fTJ3Xu4fZPKmnz/ptYA.xlCY0AwFU8dytOHv.',
      role: 'vendor',
      isActive: true,
      isEmailVerified: true,
      createdById: ID.admin,
    },
  ];

  // upsert so re-running the seed always writes the correct password hash
  for (const u of userData) {
    const { id, ...rest } = u;
    await users.user.upsert({ where: { id }, update: rest, create: u });
  }

  await users.vendorProfile.createMany({
    data: [
      {
        userId: ID.vendor1,
        businessName: 'Ceylon Hotels & Resorts',
        serviceType: 'hotel',
        businessRegistrationNumber: 'CRM-VND-001',
        addressCity: 'Colombo',
        addressCountry: 'Sri Lanka',
        contactPersonName: 'Saman Perera',
        contactPersonPhone: '+94112345678',
        contactPersonEmail: 'saman@ceylonhotels.lk',
        vendorStatus: 'verified',
        rating: 4.5,
        totalBookings: 38,
      },
    ],
    skipDuplicates: true,
  });
}

async function seedPackages() {
  console.log('  → crm_packages');

  // ── Places (master dictionary) ─────────────────────────────
  const placeIds = {
    colombo:       'c1000000-0000-4000-8000-000000000001',
    sigiriya:      'c1000000-0000-4000-8000-000000000002',
    dambulla:      'c1000000-0000-4000-8000-000000000003',
    kandy:         'c1000000-0000-4000-8000-000000000004',
    nuwaraEliya:   'c1000000-0000-4000-8000-000000000005',
    bentota:       'c1000000-0000-4000-8000-000000000006',
    male:          'c1000000-0000-4000-8000-000000000007',
    northMaleAtoll:'c1000000-0000-4000-8000-000000000008',
  };

  await pkg.place.createMany({
    data: [
      { id: placeIds.colombo,        name: 'Colombo',          type: 'CITY' },
      { id: placeIds.sigiriya,       name: 'Sigiriya',         type: 'ATTRACTION', defaultCost: 30 },
      { id: placeIds.dambulla,       name: 'Dambulla',         type: 'CITY' },
      { id: placeIds.kandy,          name: 'Kandy',            type: 'CITY' },
      { id: placeIds.nuwaraEliya,    name: 'Nuwara Eliya',     type: 'CITY' },
      { id: placeIds.bentota,        name: 'Bentota',          type: 'REGION' },
      { id: placeIds.male,           name: 'Malé',             type: 'CITY' },
      { id: placeIds.northMaleAtoll, name: 'North Malé Atoll', type: 'REGION' },
    ],
    skipDuplicates: true,
  });

  // ── Activity Catalog ───────────────────────────────────────
  const actIds = {
    cityTour:      'c2000000-0000-4000-8000-000000000001',
    welcomeDinner: 'c2000000-0000-4000-8000-000000000002',
    rockClimbing:  'c2000000-0000-4000-8000-000000000003',
    caveTemples:   'c2000000-0000-4000-8000-000000000004',
    templeVisit:   'c2000000-0000-4000-8000-000000000005',
    teaTasting:    'c2000000-0000-4000-8000-000000000006',
    swimming:      'c2000000-0000-4000-8000-000000000007',
    waterSports:   'c2000000-0000-4000-8000-000000000008',
    snorkeling:    'c2000000-0000-4000-8000-000000000009',
    scubaDiving:   'c2000000-0000-4000-8000-000000000010',
    dolphinWatch:  'c2000000-0000-4000-8000-000000000011',
    sunsetCruise:  'c2000000-0000-4000-8000-000000000012',
    islandShop:    'c2000000-0000-4000-8000-000000000013',
  };

  await pkg.activityCatalog.createMany({
    data: [
      { id: actIds.cityTour,      name: 'City tour',            description: 'Guided city sightseeing',         defaultCost: 25 },
      { id: actIds.welcomeDinner, name: 'Welcome dinner',       description: 'Traditional welcome meal',         defaultCost: 40 },
      { id: actIds.rockClimbing,  name: 'Rock climbing',        description: 'Sigiriya rock fortress climb',    defaultCost: 30 },
      { id: actIds.caveTemples,   name: 'Cave temples',         description: 'Dambulla cave temple complex',    defaultCost: 15 },
      { id: actIds.templeVisit,   name: 'Temple visit',         description: 'Temple of the Tooth visit',       defaultCost: 10 },
      { id: actIds.teaTasting,    name: 'Tea tasting',          description: 'Ceylon tea plantation tour',      defaultCost: 20 },
      { id: actIds.swimming,      name: 'Swimming',             description: 'Beach swimming',                  defaultCost: 0 },
      { id: actIds.waterSports,   name: 'Water sports',         description: 'Jet ski, banana boat, etc.',      defaultCost: 50 },
      { id: actIds.snorkeling,    name: 'Snorkeling orientation', description: 'Introductory snorkeling session', defaultCost: 45 },
      { id: actIds.scubaDiving,   name: 'Scuba diving',         description: 'Full scuba dive with instructor', defaultCost: 120 },
      { id: actIds.dolphinWatch,  name: 'Dolphin watching',     description: 'Sunset dolphin cruise',           defaultCost: 60 },
      { id: actIds.sunsetCruise,  name: 'Sunset cruise',        description: 'Luxury sunset cruise',            defaultCost: 80 },
      { id: actIds.islandShop,    name: 'Island shopping',      description: 'Malé local market shopping',      defaultCost: 0 },
    ],
    skipDuplicates: true,
  });

  // ── Packages ───────────────────────────────────────────────
  await pkg.package.
  createMany({
    data: [
      {
        id: ID.pkg1,
        title: 'Sri Lanka Heritage Explorer',
        slug: 'sri-lanka-heritage-explorer',
        description: 'Discover the ancient wonders and pristine beaches of Sri Lanka on this 4-day journey through UNESCO Heritage sites, lush tea estates, and tropical coastlines.',
        destination: 'Sri Lanka',
        durationDays: 4,
        category: 'FAMILY',
        coverImage: 'https://picsum.photos/seed/srilanka/800/500',
        inclusions: ['Airport transfers', 'Accommodation (4 nights)', 'Daily breakfast', 'All entry tickets', 'English-speaking guide'],
        exclusions: ['International flights', 'Travel insurance', 'Personal expenses', 'Lunch on day 3'],
        termsAndConditions: '50% advance payment required. Cancellation 7 days before: full refund. No refund within 48 hours.',
        basePrice: 1200,
        defaultMarginType: 'PERCENTAGE',
        defaultMarginInput: 20,
        currency: 'USD',
        isActive: true,
        isFeatured: true,
        rating: 4.7,
        numReviews: 23,
        views: 412,
        bookings: 18,
        createdBy: ID.admin,
      },
      {
        id: ID.pkg2,
        title: 'Maldives Luxury Escape',
        slug: 'maldives-luxury-escape',
        description: 'Three nights of pure indulgence in a private overwater villa. Crystal-clear lagoons, world-class diving, and breathtaking sunsets await.',
        destination: 'Maldives',
        durationDays: 3,
        category: 'HONEYMOON',
        coverImage: 'https://picsum.photos/seed/maldives/800/500',
        inclusions: ['Seaplane transfers', 'Overwater villa (3 nights)', 'All-inclusive meals', 'Two diving sessions', 'Sunset cruise'],
        exclusions: ['International flights', 'Spa treatments', 'Alcoholic beverages beyond package'],
        termsAndConditions: 'Full payment required at booking. Non-refundable after 14 days before travel.',
        basePrice: 3500,
        defaultMarginType: 'PERCENTAGE',
        defaultMarginInput: 15,
        currency: 'USD',
        isActive: true,
        isFeatured: true,
        rating: 4.9,
        numReviews: 11,
        views: 887,
        bookings: 9,
        createdBy: ID.admin,
      },
      {
        id: ID.pkg3,
        title: 'Thailand Family Adventure',
        slug: 'thailand-family-adventure',
        description: 'A fun-filled 5-day family package covering Bangkok temples, floating markets, and the golden beaches of Phuket.',
        destination: 'Thailand',
        durationDays: 5,
        category: 'FAMILY',
        coverImage: 'https://picsum.photos/seed/thailand/800/500',
        inclusions: ['All hotel stays', 'Daily breakfast and dinner', 'Guided city tours', 'Beach transfers'],
        exclusions: ['International flights', 'Lunch', 'Personal shopping'],
        termsAndConditions: '30% deposit to confirm. 14-day cancellation policy.',
        basePrice: 1800,
        defaultMarginType: 'FIXED',
        defaultMarginInput: 300,
        currency: 'USD',
        isActive: true,
        isFeatured: false,
        rating: 4.5,
        numReviews: 7,
        views: 263,
        bookings: 5,
        createdBy: ID.admin,
      },
    ],
    skipDuplicates: true,
  });

  // ── Itinerary Days — Sri Lanka (pkg1) ─────────────────────
  const dayIds = {
    sl1: 'c3000000-0000-4000-8000-000000000001',
    sl2: 'c3000000-0000-4000-8000-000000000002',
    sl3: 'c3000000-0000-4000-8000-000000000003',
    sl4: 'c3000000-0000-4000-8000-000000000004',
    mv1: 'c3000000-0000-4000-8000-000000000005',
    mv2: 'c3000000-0000-4000-8000-000000000006',
    mv3: 'c3000000-0000-4000-8000-000000000007',
  };

  await pkg.itineraryDay.createMany({
    data: [
      { id: dayIds.sl1, packageId: ID.pkg1, dayNumber: 1, title: 'Arrival in Colombo', description: 'Airport pickup and city tour', breakfastCount: 0, lunchCount: 0, dinnerCount: 1, images: [{ url: 'https://picsum.photos/seed/colombo-day1/800/500', publicId: 'travel-crm/itineraries/seed-colombo-day1' }] },
      { id: dayIds.sl2, packageId: ID.pkg1, dayNumber: 2, title: 'Sigiriya Rock Fortress', description: 'UNESCO Heritage site visit', breakfastCount: 1, lunchCount: 1, dinnerCount: 1 },
      { id: dayIds.sl3, packageId: ID.pkg1, dayNumber: 3, title: 'Kandy & Tea Estates', description: 'Temple of Tooth and tea plantation', breakfastCount: 1, lunchCount: 0, dinnerCount: 1 },
      { id: dayIds.sl4, packageId: ID.pkg1, dayNumber: 4, title: 'Beach Day at Bentota', description: 'Relax on pristine beaches', breakfastCount: 1, lunchCount: 1, dinnerCount: 1 },
      { id: dayIds.mv1, packageId: ID.pkg2, dayNumber: 1, title: 'Maldives Arrival', description: 'Seaplane transfer to resort', breakfastCount: 0, lunchCount: 1, dinnerCount: 1 },
      { id: dayIds.mv2, packageId: ID.pkg2, dayNumber: 2, title: 'Reef Exploration', description: 'Full day diving and snorkeling', breakfastCount: 1, lunchCount: 1, dinnerCount: 1 },
      { id: dayIds.mv3, packageId: ID.pkg2, dayNumber: 3, title: 'Sunset Cruise & Departure', description: 'Luxury sunset cruise before departure', breakfastCount: 1, lunchCount: 0, dinnerCount: 1 },
    ],
    skipDuplicates: true,
  });

  // Reconcile dayIds with whatever actually exists for (packageId, dayNumber).
  // Real usage (e.g. editing one of these seeded packages in Management)
  // can create ItineraryDay rows with fresh UUIDs that collide with these
  // fixed seed ids on the @@unique([packageId, dayNumber]) constraint —
  // skipDuplicates then silently skips our insert, leaving a *different* id
  // in place. Remap so every downstream place/activity/transport insert
  // below references a row that actually exists, instead of failing with a
  // foreign key violation against the original fixed id.
  const dayKeyByPackageAndNumber = {
    [`${ID.pkg1}:1`]: 'sl1', [`${ID.pkg1}:2`]: 'sl2', [`${ID.pkg1}:3`]: 'sl3', [`${ID.pkg1}:4`]: 'sl4',
    [`${ID.pkg2}:1`]: 'mv1', [`${ID.pkg2}:2`]: 'mv2', [`${ID.pkg2}:3`]: 'mv3',
  };
  const existingDays = await pkg.itineraryDay.findMany({
    where: { packageId: { in: [ID.pkg1, ID.pkg2] } },
  });
  for (const day of existingDays) {
    const key = dayKeyByPackageAndNumber[`${day.packageId}:${day.dayNumber}`];
    if (key) dayIds[key] = day.id;
  }

  // ── Day Places ─────────────────────────────────────────────
  await pkg.packageDayPlace.createMany({
    data: [
      { itineraryDayId: dayIds.sl1, placeId: placeIds.colombo,     orderIndex: 0 },
      { itineraryDayId: dayIds.sl2, placeId: placeIds.sigiriya,    orderIndex: 0 },
      { itineraryDayId: dayIds.sl2, placeId: placeIds.dambulla,    orderIndex: 1 },
      { itineraryDayId: dayIds.sl3, placeId: placeIds.kandy,       orderIndex: 0 },
      { itineraryDayId: dayIds.sl3, placeId: placeIds.nuwaraEliya, orderIndex: 1 },
      { itineraryDayId: dayIds.sl4, placeId: placeIds.bentota,     orderIndex: 0 },
      { itineraryDayId: dayIds.mv1, placeId: placeIds.male,           orderIndex: 0 },
      { itineraryDayId: dayIds.mv1, placeId: placeIds.northMaleAtoll, orderIndex: 1 },
      { itineraryDayId: dayIds.mv2, customName: 'House Reef',           orderIndex: 0 },
      { itineraryDayId: dayIds.mv3, placeId: placeIds.male,           orderIndex: 0 },
    ],
    skipDuplicates: true,
  });

  // ── Day Activities ─────────────────────────────────────────
  await pkg.packageDayActivity.createMany({
    data: [
      { itineraryDayId: dayIds.sl1, activityId: actIds.cityTour,      orderIndex: 0 },
      { itineraryDayId: dayIds.sl1, activityId: actIds.welcomeDinner, orderIndex: 1 },
      { itineraryDayId: dayIds.sl2, activityId: actIds.rockClimbing,  orderIndex: 0 },
      { itineraryDayId: dayIds.sl2, activityId: actIds.caveTemples,   orderIndex: 1 },
      { itineraryDayId: dayIds.sl3, activityId: actIds.templeVisit,   orderIndex: 0 },
      { itineraryDayId: dayIds.sl3, activityId: actIds.teaTasting,    orderIndex: 1 },
      { itineraryDayId: dayIds.sl4, activityId: actIds.swimming,      orderIndex: 0 },
      { itineraryDayId: dayIds.sl4, activityId: actIds.waterSports,   orderIndex: 1 },
      { itineraryDayId: dayIds.mv1, activityId: actIds.snorkeling,    orderIndex: 0 },
      { itineraryDayId: dayIds.mv2, activityId: actIds.scubaDiving,   orderIndex: 0 },
      { itineraryDayId: dayIds.mv2, activityId: actIds.dolphinWatch,  orderIndex: 1 },
      { itineraryDayId: dayIds.mv3, activityId: actIds.sunsetCruise,  orderIndex: 0 },
      { itineraryDayId: dayIds.mv3, activityId: actIds.islandShop,    orderIndex: 1 },
    ],
    skipDuplicates: true,
  });

  // ── Day Transports ─────────────────────────────────────────
  await pkg.packageDayTransport.createMany({
    data: [
      { itineraryDayId: dayIds.sl1, routeType: 'DAILY_ROUTING', transportMode: 'CAR',   pricingModel: 'PER_VEHICLE', unitCost: 80 },
      { itineraryDayId: dayIds.sl2, routeType: 'DAILY_ROUTING', transportMode: 'VAN',   pricingModel: 'PER_VEHICLE', unitCost: 120 },
      { itineraryDayId: dayIds.sl3, routeType: 'DAILY_ROUTING', transportMode: 'TRAIN', pricingModel: 'PER_PERSON',  unitCost: 15 },
      { itineraryDayId: dayIds.sl4, routeType: 'DAILY_ROUTING', transportMode: 'CAR',   pricingModel: 'PER_KM',      unitCost: 2, distanceKm: 80 },
      { itineraryDayId: dayIds.mv1, routeType: 'POINT_TO_POINT', transportMode: 'BOAT',  pricingModel: 'PER_PERSON',  unitCost: 250, originPlaceId: placeIds.male, destinationPlaceId: placeIds.northMaleAtoll },
      { itineraryDayId: dayIds.mv2, routeType: 'DAILY_ROUTING',  transportMode: 'BOAT',  pricingModel: 'PER_VEHICLE', unitCost: 180 },
      { itineraryDayId: dayIds.mv3, routeType: 'DAILY_ROUTING',  transportMode: 'BOAT',  pricingModel: 'PER_VEHICLE', unitCost: 200 },
    ],
    skipDuplicates: true,
  });

  // ── Reviews ────────────────────────────────────────────────
  await pkg.review.createMany({
    data: [
      { packageId: ID.pkg1, authorId: ID.customer1, name: 'David Kumar', email: 'david.kumar@gmail.com', rating: 5, comment: 'Absolutely incredible trip! The guide was knowledgeable and the itinerary was perfectly paced. Sigiriya at sunrise was unforgettable.', isApproved: true, helpful: 12 },
      { packageId: ID.pkg1, name: 'Priya S.', email: 'priya.s@hotmail.com', rating: 4, comment: 'Great value for money. The tea train ride was a highlight. Would have liked one more beach day.', isApproved: true, helpful: 5 },
      { packageId: ID.pkg2, authorId: ID.customer2, name: 'Emily Chen', email: 'emily.chen@gmail.com', rating: 5, comment: 'Perfection. The overwater villa was exactly as advertised. The diving instructor was outstanding. Worth every penny.', isApproved: true, helpful: 20 },
      { packageId: ID.pkg3, name: 'James T.', email: 'james.t@yahoo.com', rating: 4, comment: 'Kids loved the elephant sanctuary. Bangkok temple tour was a bit rushed but overall great family experience.', isApproved: true, helpful: 8 },
    ],
    skipDuplicates: true,
  });
}

async function seedLeads() {
  console.log('  → crm_leads');

  // Lead status is the `lifecycleStatus` enum now — the LeadStatusOption table
  // was removed in the 2026-08-02 schema rebuild, so there's nothing to seed.

  // Package choice moved off the Lead onto LeadPackageSelection rows; explicit
  // ids let us point each lead's primarySelectionId at its selection.
  const SEL = {
    lead1: 'e1000000-0000-0000-0000-000000000001',
    lead2: 'e1000000-0000-0000-0000-000000000002',
    lead3: 'e1000000-0000-0000-0000-000000000003',
  };

  await leads.settings.upsert({
    where: { singletonKey: 1 },
    update: {},
    create: {
      singletonKey: 1,
      assignmentMode: 'auto',
      autoStrategy: 'round_robin',
      enabledSalesRepIds: [ID.salesRep1, ID.salesRep2],
      roundRobinIndex: 0,
      maxOpenLeadsPerRep: 50,
      skipInactive: true,
      updatedById: ID.superAdmin,
    },
  });

  const lead1 = await leads.lead.upsert({
    where: { id: ID.lead1 },
    update: {},
    create: {
      id: ID.lead1,
      name: 'David Kumar',
      email: 'david.kumar@gmail.com',
      phone: '+94771234567',
      whatsapp: '+94771234567',
      city: 'Colombo',
      source: 'website',
      platform: 'Website_Form',
      fromCountry: 'Sri Lanka',
      destinationCountry: 'Maldives',
      destination: 'Maldives',
      travelDate: new Date('2025-02-14'),
      endDate: new Date('2025-02-17'),
      numberOfTravelers: 2,
      budget: 'USD 7000',
      message: 'Planning honeymoon trip for February. Looking for luxury overwater villa.',
      lifecycleStatus: 'CONFIRMED',
      priority: 'high',
      assignedToId: ID.salesRep1,
      assignedById: ID.admin,
      assignmentMode: 'auto',
      primarySelectionId: SEL.lead1,
      packageSelections: { create: [{ id: SEL.lead1, packageId: ID.pkg2, packageName: 'Maldives Luxury Escape', isManual: false }] },
      convertedBookingId: ID.booking1,
      tags: ['HONEYMOON', 'luxury', 'high-value'],
      notifNewLead: true,
      notifStatusChange: true,
      notifAssignment: true,
      notifFollowUp: true,
      remarks: {
        create: [
          { text: 'Customer is very interested in the overwater villa package. Prefers Feb 14 for Valentine\'s Day.', addedById: ID.salesRep1, addedAt: new Date('2024-12-02') },
          { text: 'Sent customized quote with room upgrade. Awaiting confirmation.', addedById: ID.salesRep1, addedAt: new Date('2024-12-05') },
        ],
      },
      statusHistory: {
        create: [
          { status: 'new', changedById: ID.admin, changedAt: new Date('2024-12-01'), notes: 'Lead created via website' },
          { status: 'contacted', changedById: ID.salesRep1, changedAt: new Date('2024-12-02'), notes: 'Called customer' },
          { status: 'interested', changedById: ID.salesRep1, changedAt: new Date('2024-12-03') },
          { status: 'quoted', changedById: ID.salesRep1, changedAt: new Date('2024-12-05') },
          { status: 'converted', changedById: ID.salesRep1, changedAt: new Date('2024-12-10'), notes: 'Booking confirmed' },
        ],
      },
      communicationLogs: {
        create: [
          { type: 'call', notes: 'Initial call — discussed package details and pricing', byId: ID.salesRep1, date: new Date('2024-12-02') },
          { type: 'email', notes: 'Sent detailed brochure and custom quote PDF', byId: ID.salesRep1, date: new Date('2024-12-05') },
        ],
      },
    },
  });

  const lead2 = await leads.lead.upsert({
    where: { id: ID.lead2 },
    update: {},
    create: {
      id: ID.lead2,
      name: 'Rajesh Nair',
      email: 'rajesh.nair@outlook.com',
      phone: '+919876543210',
      city: 'Mumbai',
      source: 'facebook',
      platform: 'Facebook',
      fromCountry: 'India',
      destinationCountry: 'Sri Lanka',
      destination: 'Sri Lanka',
      travelDate: new Date('2025-03-15'),
      endDate: new Date('2025-03-19'),
      numberOfTravelers: 4,
      budget: 'USD 5000',
      message: 'Family of 4 (2 adults, 2 kids aged 8 and 12). Interested in Sri Lanka Heritage package.',
      lifecycleStatus: 'QUOTED',
      priority: 'medium',
      assignedToId: ID.salesRep2,
      assignedById: ID.admin,
      assignmentMode: 'auto',
      primarySelectionId: SEL.lead2,
      packageSelections: { create: [{ id: SEL.lead2, packageId: ID.pkg1, packageName: 'Sri Lanka Heritage Explorer', isManual: false }] },
      followUpDate: new Date('2025-01-10'),
      tags: ['FAMILY', 'kids', 'heritage'],
      remarks: {
        create: [
          { text: 'Family trip with young children. Need child-friendly hotel options.', addedById: ID.salesRep2 },
        ],
      },
      statusHistory: {
        create: [
          { status: 'new', changedById: ID.admin, changedAt: new Date('2024-12-15') },
          { status: 'contacted', changedById: ID.salesRep2, changedAt: new Date('2024-12-16') },
          { status: 'interested', changedById: ID.salesRep2, changedAt: new Date('2024-12-18') },
          { status: 'quoted', changedById: ID.salesRep2, changedAt: new Date('2024-12-20') },
        ],
      },
      communicationLogs: {
        create: [
          { type: 'call', notes: 'Discussed family needs — child-friendly activities and hotels required', byId: ID.salesRep2, date: new Date('2024-12-16') },
        ],
      },
    },
  });

  await leads.lead.upsert({
    where: { id: ID.lead3 },
    update: {},
    create: {
      id: ID.lead3,
      name: 'Sophie Laurent',
      email: 'sophie.laurent@gmail.com',
      phone: '+33612345678',
      city: 'Paris',
      source: 'email',
      platform: 'Email',
      fromCountry: 'France',
      destinationCountry: 'Thailand',
      destination: 'Thailand',
      travelDate: new Date('2025-04-01'),
      numberOfTravelers: 3,
      budget: 'USD 5500',
      lifecycleStatus: 'NEW',
      priority: 'low',
      assignedToId: ID.salesRep1,
      primarySelectionId: SEL.lead3,
      packageSelections: { create: [{ id: SEL.lead3, packageId: ID.pkg3, packageName: 'Thailand Family Adventure', isManual: false }] },
      tags: ['group', 'beach'],
      remarks: { create: [] },
      statusHistory: {
        create: [
          { status: 'new', changedById: ID.admin, changedAt: new Date('2024-12-28') },
        ],
      },
      communicationLogs: { create: [] },
    },
  });
}

async function seedBookings() {
  console.log('  → crm_bookings');
  await books.booking.upsert({
    where: { id: ID.booking1 },
    update: {},
    create: {
      id: ID.booking1,
      userId: ID.customer1,
      packageId: ID.pkg2,
      invoiceId: ID.invoice1,
      assignedToId: ID.salesRep1,
      travelDate: new Date('2025-02-14'),
      endDate: new Date('2025-02-17'),
      numberOfTravelers: 2,
      totalAmount: 7000,
      paidAmount: 7000,
      paymentStatus: 'paid',
      bookingStatus: 'confirmed',
      specialRequests: 'Honeymoon setup in villa — rose petals and champagne on arrival please.',
      confirmedAt: new Date('2024-12-10'),
      travelers: {
        create: [
          { name: 'David Kumar', age: 32, gender: 'male', idType: 'passport', idNumber: 'N1234567' },
          { name: 'Priya Kumar', age: 29, gender: 'female', idType: 'passport', idNumber: 'N7654321' },
        ],
      },
    },
  });

  await books.booking.upsert({
    where: { id: ID.booking2 },
    update: {},
    create: {
      id: ID.booking2,
      userId: ID.customer2,
      packageId: ID.pkg1,
      assignedToId: ID.salesRep2,
      travelDate: new Date('2025-03-20'),
      endDate: new Date('2025-03-24'),
      numberOfTravelers: 1,
      totalAmount: 1200,
      paidAmount: 600,
      paymentStatus: 'partial',
      bookingStatus: 'pending',
      specialRequests: 'Vegetarian meals preferred.',
      travelers: {
        create: [
          { name: 'Emily Chen', age: 27, gender: 'female', idType: 'passport', idNumber: 'E9876543' },
        ],
      },
    },
  });
}

async function seedBilling() {
  console.log('  → crm_billing');

  // Invoice 1 — paid in full
  await bill.invoice.upsert({
    where: { id: ID.invoice1 },
    update: {},
    create: {
      id: ID.invoice1,
      invoiceNumber: 'INV-202412-00001',
      leadId: ID.lead1,
      bookingId: ID.booking1,
      createdById: ID.salesRep1,
      customerName: 'David Kumar',
      customerEmail: 'david.kumar@gmail.com',
      customerPhone: '+94771234567',
      customerAddress: 'Colombo, Sri Lanka',
      type: 'invoice',
      subtotal: 7000,
      taxRate: 0,
      taxAmount: 0,
      discountType: 'none',
      discountValue: 0,
      discountAmount: 0,
      totalAmount: 7000,
      paidAmount: 7000,
      outstandingAmount: 0,
      status: 'paid',
      paymentStatus: 'paid',
      dueDate: new Date('2024-12-15'),
      issueDate: new Date('2024-12-10'),
      paidDate: new Date('2024-12-12'),
      emailSent: true,
      sentAt: new Date('2024-12-10'),
      items: {
        create: [
          { description: 'Maldives Luxury Escape — 2 persons (3 nights)', category: 'package', quantity: 1, unitPrice: 6000, totalPrice: 6000, order: 0 },
          { description: 'Valentine\'s Honeymoon Room Upgrade', category: 'accommodation', quantity: 1, unitPrice: 800, totalPrice: 800, order: 1 },
          { description: 'Airport Transfer Premium', category: 'transportation', quantity: 1, unitPrice: 200, totalPrice: 200, order: 2 },
        ],
      },
    },
  });

  // Invoice 2 — partial payment
  await bill.invoice.upsert({
    where: { id: ID.invoice2 },
    update: {},
    create: {
      id: ID.invoice2,
      invoiceNumber: 'INV-202412-00002',
      leadId: ID.lead2,
      createdById: ID.salesRep2,
      customerName: 'Rajesh Nair',
      customerEmail: 'rajesh.nair@outlook.com',
      customerPhone: '+919876543210',
      customerAddress: 'Mumbai, India',
      type: 'invoice',
      subtotal: 4800,
      taxRate: 5,
      taxAmount: 240,
      discountType: 'fixed',
      discountValue: 200,
      discountAmount: 200,
      totalAmount: 4840,
      paidAmount: 1500,
      outstandingAmount: 3340,
      status: 'partial',
      paymentStatus: 'partial',
      dueDate: new Date('2025-01-15'),
      issueDate: new Date('2024-12-20'),
      emailSent: true,
      sentAt: new Date('2024-12-20'),
      items: {
        create: [
          { description: 'Sri Lanka Heritage Explorer — 4 persons (4 nights)', category: 'package', quantity: 4, unitPrice: 1100, totalPrice: 4400, order: 0 },
          { description: 'Child Activity Supplement (2 children)', category: 'activity', quantity: 2, unitPrice: 200, totalPrice: 400, order: 1 },
        ],
      },
    },
  });

  // Trip snapshot enriching the branded quotation PDF (mirrors pkg1's itinerary).
  const quotation1Trip = {
    destination: 'Sri Lanka',
    packageTitle: 'Sri Lanka Heritage Explorer',
    travelStartDate: new Date('2025-01-10'),
    travelEndDate: new Date('2025-01-13'),
    paxCount: 4,
    durationNights: 3,
    durationDays: 4,
    highlights: [
      'UNESCO heritage sites including Sigiriya Rock Fortress',
      'Temple of the Tooth & Kandy tea estates',
      'Relaxing beach day at Bentota',
      'Private guided tours with daily breakfast',
    ],
    itineraryDays: [
      { day: 1, title: 'Arrival in Colombo', locations: ['Colombo'], meals: ['Dinner'] },
      { day: 2, title: 'Sigiriya Rock Fortress', locations: ['Sigiriya'], meals: ['Breakfast', 'Lunch', 'Dinner'] },
      { day: 3, title: 'Kandy & Tea Estates', locations: ['Kandy'], meals: ['Breakfast', 'Dinner'] },
      { day: 4, title: 'Beach Day at Bentota', locations: ['Bentota'], meals: ['Breakfast', 'Lunch', 'Dinner'] },
    ],
  };

  // Quotation 1
  await bill.quotation.upsert({
    where: { id: ID.quotation1 },
    update: quotation1Trip,
    create: {
      ...quotation1Trip,
      id: ID.quotation1,
      quotationNumber: 'QT-202412-00001',
      leadId: ID.lead2,
      createdById: ID.salesRep2,
      customerName: 'Rajesh Nair',
      customerEmail: 'rajesh.nair@outlook.com',
      customerPhone: '+919876543210',
      type: 'package_based',
      mode: 'detailed',
      packageId: ID.pkg1,
      subtotal: 4800,
      taxRate: 5,
      taxAmount: 214,
      discountType: 'fixed',
      discountValue: 200,
      discountAmount: 200,
      totalAmount: 4814,
      status: 'accepted',
      issueDate: new Date('2024-12-18'),
      validUntil: new Date('2025-01-18'),
      emailSent: true,
      sentAt: new Date('2024-12-18'),
      acceptedAt: new Date('2024-12-20'),
      version: 1,
      includedServices: ['Airport transfers', 'Accommodation', 'Daily breakfast', 'Guided tours', 'Entry tickets'],
      excludedServices: ['International flights', 'Travel insurance', 'Lunch & dinner (except included days)', 'Personal expenses'],
      convertedToInvoiceId: ID.invoice2,
      items: {
        create: [
          { description: 'Sri Lanka Heritage Explorer — 4 persons', category: 'package', quantity: 4, unitPrice: 1100, totalPrice: 4400, order: 0 },
          { description: 'Child Activity Supplement', category: 'activity', quantity: 2, unitPrice: 200, totalPrice: 400, order: 1 },
        ],
      },
    },
  });

  // Payment Receipt for invoice1
  await bill.paymentReceipt.upsert({
    where: { id: ID.receipt1 },
    update: {},
    create: {
      id: ID.receipt1,
      receiptNumber: 'REC-202412-00001',
      leadId: ID.lead1,
      invoiceId: ID.invoice1,
      createdById: ID.salesRep1,
      customerName: 'David Kumar',
      customerEmail: 'david.kumar@gmail.com',
      customerPhone: '+94771234567',
      amount: 7000,
      currency: 'USD',
      paymentMethod: 'card',
      paymentDate: new Date('2024-12-12'),
      transactionId: 'stripe_pi_3QAbc123xyz',
      receiptStatus: 'paid_in_full',
      paymentType: 'full_payment',
      previousBalance: 7000,
      outstandingBalance: 0,
      cardType: 'visa',
      cardLastFour: '4242',
      paymentGateway: 'stripe',
      gatewayTransactionId: 'pi_3QAbc123xyz',
      verified: true,
      verifiedById: ID.admin,
      verifiedAt: new Date('2024-12-12'),
      emailSent: true,
      sentAt: new Date('2024-12-12'),
      paymentHistories: {
        create: [
          {
            paymentHistoryNumber: 'PH-202412-00001',
            leadId: ID.lead1,
            invoiceId: ID.invoice1,
            customerName: 'David Kumar',
            customerEmail: 'david.kumar@gmail.com',
            amount: 7000,
            currency: 'USD',
            paymentMethod: 'card',
            paymentDate: new Date('2024-12-12'),
            transactionId: 'stripe_pi_3QAbc123xyz',
            paymentType: 'full_payment',
            status: 'verified',
            createdById: ID.salesRep1,
            verifiedById: ID.admin,
            verifiedAt: new Date('2024-12-12'),
          },
        ],
      },
    },
  });
}

async function seedCareers() {
  console.log('  → crm_careers');
  await career.vacancy.createMany({
    data: [
      {
        id: ID.vacancy1,
        position: 'Senior Travel Consultant',
        description: 'We are looking for an experienced travel consultant to join our growing team. You will be responsible for crafting personalised travel itineraries, managing client relationships, and achieving sales targets.',
        type: 'Full_Time',
        location: 'Colombo, Sri Lanka',
        experienceMin: 3,
        status: 'active',
        createdById: ID.admin,
        closingDate: new Date('2025-02-28'),
      },
      {
        id: ID.vacancy2,
        position: 'Digital Marketing Executive',
        description: 'Manage social media campaigns, SEO, and paid advertising for our travel packages. Experience with Google Ads and Meta Ads required.',
        type: 'Full_Time',
        location: 'Remote',
        experienceMin: 2,
        status: 'active',
        createdById: ID.admin,
        closingDate: new Date('2025-01-31'),
      },
    ],
    skipDuplicates: true,
  });

  await career.career.createMany({
    data: [
      {
        fullName: 'Nimal Silva',
        email: 'nimal.silva@gmail.com',
        phone: '+94701234567',
        position: 'Senior Travel Consultant',
        coverLetter: 'I have 5 years of experience in the travel industry with a proven track record of exceeding sales targets. I am passionate about creating memorable travel experiences for clients.',
        agreeTerms: true,
        status: 'shortlisted',
        reviewedById: ID.admin,
        reviewedAt: new Date('2024-12-20'),
        emailSent: true,
      },
      {
        fullName: 'Kasun Mendis',
        email: 'kasun.mendis@yahoo.com',
        phone: '+94711234567',
        position: 'Digital Marketing Executive',
        coverLetter: 'I specialise in performance marketing for travel brands. I have managed campaigns with budgets exceeding $50k/month and consistently delivered ROAS above 4x.',
        agreeTerms: true,
        status: 'pending',
        emailSent: false,
      },
    ],
    skipDuplicates: true,
  });
}

async function seedAuth() {
  console.log('  → crm_auth');
  // OTPs are short-lived; seed one example for dev testing
  await auth.otp.createMany({
    data: [
      {
        userId: ID.customer2,
        code: '482910',
        type: 'emailVerification',
        email: 'emily.chen@gmail.com',
        isUsed: false,
        attempts: 0,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // expires in 24h
      },
    ],
    skipDuplicates: true,
  });
}

async function main() {
  console.log('Seeding Travel CRM database...\n');
  try {
    await seedUsers();
    await seedPackages();
    await seedLeads();
    await seedBookings();
    await seedBilling();
    await seedCareers();
    await seedAuth();
    console.log('\n✓ All schemas seeded successfully.');
  } catch (err) {
    console.error('\n✗ Seed failed:', err.message);
    throw err;
  } finally {
    await Promise.all([auth.$disconnect(), users.$disconnect(), pkg.$disconnect(), leads.$disconnect(), books.$disconnect(), bill.$disconnect(), career.$disconnect()]);
  }
}

main();
