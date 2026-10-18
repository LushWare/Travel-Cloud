/**
 * Extended seed — adds rich mock data to every table.
 * Safe to run multiple times (skipDuplicates / upsert throughout).
 * Run from Services/: node seed-extended.mjs
 */

import { PrismaClient as AuthClient }   from './auth-service/node_modules/@prisma/client/index.js';
import { PrismaClient as UserClient }   from './user-service/node_modules/@prisma/client/index.js';
import { PrismaClient as PkgClient }    from './package-service/node_modules/@prisma/client/index.js';
import { PrismaClient as LeadClient }   from './lead-service/node_modules/@prisma/client/index.js';
import { PrismaClient as BookClient }   from './booking-service/node_modules/@prisma/client/index.js';
import { PrismaClient as BillClient }   from './billing-service/node_modules/@prisma/client/index.js';
import { PrismaClient as CareerClient } from './career-service/node_modules/@prisma/client/index.js';
import { requireDatabaseUrl } from './database-url.mjs';

const DB_URL = requireDatabaseUrl('seed-extended.mjs');
const opts = { datasources: { db: { url: DB_URL } } };

const auth   = new AuthClient(opts);
const users  = new UserClient(opts);
const pkg    = new PkgClient(opts);
const leads  = new LeadClient(opts);
const books  = new BookClient(opts);
const bill   = new BillClient(opts);
const career = new CareerClient(opts);

// ─── Existing IDs (from seed.mjs) ────────────────────────────────────────────
const E = {
  superAdmin: 'a0000000-0000-0000-0000-000000000001',
  admin:      'a0000000-0000-0000-0000-000000000002',
  salesRep1:  'a0000000-0000-0000-0000-000000000003',
  salesRep2:  'a0000000-0000-0000-0000-000000000004',
  customer1:  'a0000000-0000-0000-0000-000000000005',
  customer2:  'a0000000-0000-0000-0000-000000000006',
  vendor1:    'a0000000-0000-0000-0000-000000000007',
  pkg1: 'b0000000-0000-0000-0000-000000000001',
  pkg2: 'b0000000-0000-0000-0000-000000000002',
  pkg3: 'b0000000-0000-0000-0000-000000000003',
  lead1: 'd0000000-0000-0000-0000-000000000001',
  lead2: 'd0000000-0000-0000-0000-000000000002',
  lead3: 'd0000000-0000-0000-0000-000000000003',
  invoice1: 'f0000000-0000-0000-0000-000000000001',
  invoice2: 'f0000000-0000-0000-0000-000000000002',
};

// ─── New IDs ──────────────────────────────────────────────────────────────────
const N = {
  // Users
  admin2:     'a0000000-0000-0000-0000-000000000008',
  salesRep3:  'a0000000-0000-0000-0000-000000000009',
  salesRep4:  'a0000000-0000-0000-0000-000000000010',
  customer3:  'a0000000-0000-0000-0000-000000000011',
  customer4:  'a0000000-0000-0000-0000-000000000012',
  customer5:  'a0000000-0000-0000-0000-000000000013',
  vendor2:    'a0000000-0000-0000-0000-000000000014',
  vendor3:    'a0000000-0000-0000-0000-000000000015',
  // Packages
  itin3:  'c0000000-0000-0000-0000-000000000003',
  itin4:  'c0000000-0000-0000-0000-000000000004',
  itin5:  'c0000000-0000-0000-0000-000000000005',
  pkg4:   'b0000000-0000-0000-0000-000000000004',
  pkg5:   'b0000000-0000-0000-0000-000000000005',
  pkg6:   'b0000000-0000-0000-0000-000000000006',
  pkg7:   'b0000000-0000-0000-0000-000000000007',
  custPkg1: 'b0000000-0000-0000-0000-000000000010',
  manItin1: 'c0000000-0000-0000-0000-000000000010',
  // Leads
  lead4:  'd0000000-0000-0000-0000-000000000004',
  lead5:  'd0000000-0000-0000-0000-000000000005',
  lead6:  'd0000000-0000-0000-0000-000000000006',
  lead7:  'd0000000-0000-0000-0000-000000000007',
  lead8:  'd0000000-0000-0000-0000-000000000008',
  lead9:  'd0000000-0000-0000-0000-000000000009',
  lead10: 'd0000000-0000-0000-0000-00000000000a',
  lead11: 'd0000000-0000-0000-0000-00000000000b',
  lead12: 'd0000000-0000-0000-0000-00000000000c',
  // Bookings
  booking3: 'e0000000-0000-0000-0000-000000000003',
  booking4: 'e0000000-0000-0000-0000-000000000004',
  booking5: 'e0000000-0000-0000-0000-000000000005',
  // Billing
  invoice3: 'f0000000-0000-0000-0000-000000000010',
  invoice4: 'f0000000-0000-0000-0000-000000000011',
  invoice5: 'f0000000-0000-0000-0000-000000000012',
  invoice6: 'f0000000-0000-0000-0000-000000000013',
  quotation2: 'f0000000-0000-0000-0000-000000000020',
  quotation3: 'f0000000-0000-0000-0000-000000000021',
  receipt2: 'f0000000-0000-0000-0000-000000000030',
  receipt3: 'f0000000-0000-0000-0000-000000000031',
  creditNote1: 'f0000000-0000-0000-0000-000000000040',
  voucher1: 'f0000000-0000-0000-0000-000000000050',
  voucher2: 'f0000000-0000-0000-0000-000000000051',
};

// ─── Bcrypt hashes ────────────────────────────────────────────────────────────
const H = {
  admin:    '$2a$12$IGpR6h2fwoq.9XOdOD0Q2.ay5LGxEHO5G8j2yRYGmwSS158JedYAq',
  sales:    '$2a$12$5h8H2D5w2SLBYX4qxQYW9u8OPbl1hct8O0Eim8jekgxgyS4tWJG12',
  customer: '$2a$12$rlRQ1ZhMpqTk.JNK7c7bhOKAwc9BxsqDObsWJX/IWV81XRUtQ1UES',
  vendor:   '$2a$12$zSvnKMlAYyA2zgAaeAmB.OdaI0VrvDlZDmp87tXtDqk3UKKin4Une',
};

// ─── 1. Users ─────────────────────────────────────────────────────────────────
async function seedUsers() {
  console.log('  → crm_users (extended)');

  const newUsers = [
    { id: N.admin2,    name: 'Mark Admin',     email: 'mark.admin@travelcrm.com',    password: H.admin,    role: 'admin',    permissions: ['manage_users','manage_leads','manage_packages','view_reports','manage_billing','view_billing'], isActive: true, isEmailVerified: true, createdById: E.superAdmin },
    { id: N.salesRep3, name: 'Diana Sales',    email: 'diana.sales@travelcrm.com',   password: H.sales,   role: 'salesRep', permissions: ['manage_leads','view_billing'], isActive: true, isEmailVerified: true, createdById: E.admin },
    { id: N.salesRep4, name: 'Ethan Sales',    email: 'ethan.sales@travelcrm.com',   password: H.sales,   role: 'salesRep', permissions: ['manage_leads','view_billing'], isActive: true, isEmailVerified: true, createdById: E.admin },
    { id: N.customer3, name: 'Arjun Sharma',   email: 'arjun.sharma@gmail.com',      password: H.customer, role: 'customer', phone: '+919812345678', phoneCountry: 'IN', isActive: true, isEmailVerified: true },
    { id: N.customer4, name: 'Fatima Al-Hassan', email: 'fatima.hassan@outlook.com', password: H.customer, role: 'customer', phone: '+971501234567', phoneCountry: 'AE', isActive: true, isEmailVerified: true },
    { id: N.customer5, name: 'James Wilson',   email: 'james.wilson@yahoo.com',      password: H.customer, role: 'customer', phone: '+447912345678', phoneCountry: 'GB', isActive: true, isEmailVerified: false },
    { id: N.vendor2,   name: 'Pradeep Fernando', email: 'pradeep@islandtransport.lk', password: H.vendor, role: 'vendor',   isActive: true, isEmailVerified: true, createdById: E.admin },
    { id: N.vendor3,   name: 'Mei Lin',        email: 'mei.lin@asiaguides.com',       password: H.vendor,  role: 'vendor',   isActive: true, isEmailVerified: true, createdById: E.admin },
  ];

  for (const u of newUsers) {
    const { id, ...rest } = u;
    await users.user.upsert({ where: { id }, update: rest, create: u });
  }

  await users.vendorProfile.createMany({
    data: [
      { userId: N.vendor2, businessName: 'Island Transport Services', serviceType: 'transport', businessRegistrationNumber: 'CRM-VND-002', addressCity: 'Colombo', addressCountry: 'Sri Lanka', contactPersonName: 'Pradeep Fernando', contactPersonPhone: '+94777234567', contactPersonEmail: 'pradeep@islandtransport.lk', vendorStatus: 'verified', rating: 4.3, totalBookings: 22 },
      { userId: N.vendor3, businessName: 'Asia Guides & Tours',       serviceType: 'guide',     businessRegistrationNumber: 'CRM-VND-003', addressCity: 'Bangkok',  addressCountry: 'Thailand',  contactPersonName: 'Mei Lin',          contactPersonPhone: '+66812345678',  contactPersonEmail: 'mei.lin@asiaguides.com',  vendorStatus: 'verified', rating: 4.8, totalBookings: 61 },
    ],
    skipDuplicates: true,
  });
}

// ─── 2. Packages ──────────────────────────────────────────────────────────────
async function seedPackages() {
  console.log('  → crm_packages (extended)');

  // Additional packages
  await pkg.package.createMany({
    data: [
      {
        id: N.pkg4, title: 'Dubai Luxury Experience', slug: 'dubai-luxury-experience',
        description: 'Four days of pure opulence in the City of Gold. Iconic skyline, desert adventures, and world-class dining await.',
        destination: 'Dubai, UAE', durationDays: 4, category: 'COUPLE',
        coverImage: 'https://picsum.photos/seed/dubai/800/500',
        inclusions: ['5-star hotel (4 nights)','All transfers','Desert safari with dinner','Burj Khalifa tickets','Abu Dhabi day trip'],
        exclusions: ['International flights','Travel insurance','Personal shopping'],
        termsAndConditions: 'Full payment required 30 days before travel. Non-refundable within 14 days.',
        basePrice: 2800, defaultMarginType: 'PERCENTAGE', defaultMarginInput: 20, currency: 'USD',
        isActive: true, isFeatured: true,
        rating: 4.8, numReviews: 16, views: 634, bookings: 12, createdBy: E.admin,
      },
      {
        id: N.pkg5, title: 'Bali Honeymoon Bliss', slug: 'bali-honeymoon-bliss',
        description: 'Five romantic days in the Island of Gods. Private villas, ancient temples, emerald rice terraces, and pristine beaches.',
        destination: 'Bali, Indonesia', durationDays: 5, category: 'HONEYMOON',
        coverImage: 'https://picsum.photos/seed/bali/800/500',
        inclusions: ['Private villa (5 nights)','Daily breakfast & dinner','Couples spa (1 session)','All guided tours','Airport transfers'],
        exclusions: ['International flights','Alcoholic beverages','Scuba diving (optional extra)'],
        termsAndConditions: '50% deposit to secure booking. Balance due 21 days before travel. Cancellation 14+ days: 50% refund.',
        basePrice: 2200, defaultMarginType: 'PERCENTAGE', defaultMarginInput: 20, currency: 'USD',
        isActive: true, isFeatured: true,
        rating: 4.9, numReviews: 29, views: 1243, bookings: 21, createdBy: E.admin,
      },
      {
        id: N.pkg6, title: 'European Grand Tour', slug: 'european-grand-tour',
        description: 'Seven days covering London, Paris, Amsterdam, and Rome. An iconic journey through Europe\'s most beloved capitals.',
        destination: 'Europe (UK, France, Netherlands, Italy)', durationDays: 7, category: 'GROUP',
        coverImage: 'https://picsum.photos/seed/europe/800/500',
        inclusions: ['5-star hotels throughout','Eurostar & Thalys rail passes','All city tours','Most meals included'],
        exclusions: ['International flights to/from London','Travel insurance','Optional excursions'],
        termsAndConditions: '30% deposit on booking. Full payment 45 days before departure. Group discount available for 10+.',
        basePrice: 4500, defaultMarginType: 'FIXED', defaultMarginInput: 500, currency: 'USD',
        isActive: true, isFeatured: true,
        rating: 4.6, numReviews: 8, views: 398, bookings: 4, createdBy: N.admin2,
      },
      {
        id: N.pkg7, title: 'Japan Cultural Journey', slug: 'japan-cultural-journey',
        description: 'Nine days of ancient temples, neon-lit city streets, bullet trains, and mountain onsen.',
        destination: 'Japan', durationDays: 9, category: 'FAMILY',
        coverImage: 'https://picsum.photos/seed/japan/800/500',
        inclusions: ['Hotels (9 nights)','JR Pass (7 days)','Tea ceremony','Mt Fuji day trip','Most breakfasts'],
        exclusions: ['International flights','Onsen (optional extra)','Most lunches and dinners'],
        termsAndConditions: '25% deposit on booking. No refund within 30 days of departure.',
        basePrice: 3900, defaultMarginType: 'PERCENTAGE', defaultMarginInput: 15, currency: 'USD',
        isActive: true, isFeatured: false,
        rating: 4.7, numReviews: 5, views: 187, bookings: 3, createdBy: N.admin2,
      },
    ],
    skipDuplicates: true,
  });

  // Package images for all packages. Fixed ids so re-running this script
  // (documented as safe to run multiple times) actually dedupes via
  // skipDuplicates instead of piling up a fresh row per run — previously
  // these had no id, so every rerun minted new random UUIDs and quietly
  // duplicated every image, which is exactly the "gallery shows way more
  // images than were ever uploaded" bug this whole change fixes. pkg1's two
  // images carry a publicId (as a real Cloudinary-backed upload would),
  // exercising the delete-cleanup path end-to-end in seeded data; the rest
  // are historic/legacy rows with no publicId, exercising the "skip
  // Cloudinary cleanup" degrade path.
  const imgs = [
    { id: 'c9000000-0000-0000-0000-000000000001', packageId: E.pkg1, url: 'https://images.unsplash.com/photo-1568797629192-789acf8e4df3?w=800', publicId: 'travel-crm/packages/seed-srilanka-1', orderIndex: 0 },
    { id: 'c9000000-0000-0000-0000-000000000002', packageId: E.pkg1, url: 'https://picsum.photos/seed/srilanka2/800/500', publicId: 'travel-crm/packages/seed-srilanka-2', orderIndex: 1 },
    { id: 'c9000000-0000-0000-0000-000000000003', packageId: E.pkg2, url: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=800', orderIndex: 0 },
    { id: 'c9000000-0000-0000-0000-000000000004', packageId: E.pkg2, url: 'https://picsum.photos/seed/maldives2/800/500', orderIndex: 1 },
    { id: 'c9000000-0000-0000-0000-000000000005', packageId: E.pkg3, url: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800', orderIndex: 0 },
    { id: 'c9000000-0000-0000-0000-000000000006', packageId: N.pkg4, url: 'https://picsum.photos/seed/dubai/800/500', orderIndex: 0 },
    { id: 'c9000000-0000-0000-0000-000000000007', packageId: N.pkg4, url: 'https://picsum.photos/seed/dubai2/800/500', orderIndex: 1 },
    { id: 'c9000000-0000-0000-0000-000000000008', packageId: N.pkg5, url: 'https://picsum.photos/seed/bali/800/500', orderIndex: 0 },
    { id: 'c9000000-0000-0000-0000-000000000009', packageId: N.pkg5, url: 'https://picsum.photos/seed/bali2/800/500', orderIndex: 1 },
    { id: 'c9000000-0000-0000-0000-00000000000a', packageId: N.pkg6, url: 'https://picsum.photos/seed/europe/800/500', orderIndex: 0 },
    { id: 'c9000000-0000-0000-0000-00000000000b', packageId: N.pkg6, url: 'https://picsum.photos/seed/europe2/800/500', orderIndex: 1 },
    { id: 'c9000000-0000-0000-0000-00000000000c', packageId: N.pkg7, url: 'https://picsum.photos/seed/japan/800/500', orderIndex: 0 },
    { id: 'c9000000-0000-0000-0000-00000000000d', packageId: N.pkg7, url: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=800', orderIndex: 1 },
  ];
  await pkg.packageImage.createMany({ data: imgs, skipDuplicates: true });

  // More reviews
  await pkg.review.createMany({
    data: [
      { packageId: E.pkg1, name: 'Suresh Bandara', email: 'suresh.b@gmail.com', rating: 5, comment: 'Absolutely stunning trip! The guide was incredibly knowledgeable about local history. Sigiriya at sunrise was a once-in-a-lifetime experience.', isApproved: true, helpful: 18 },
      { packageId: E.pkg1, name: 'Yuki Tanaka',    email: 'yuki.t@yahoo.co.jp', rating: 4, comment: 'Very well organised. The train ride through tea country was magical. Slightly rushed at Kandy but overall excellent.', isApproved: true, helpful: 7 },
      { packageId: E.pkg2, authorId: N.customer3,  name: 'Arjun Sharma', email: 'arjun.sharma@gmail.com', rating: 5, comment: 'Honeymoon trip and it was flawless. The resort exceeded every expectation. The diving was world-class.', isApproved: true, helpful: 31 },
      { packageId: E.pkg3, name: 'Laura Martinez', email: 'laura.m@hotmail.com', rating: 5, comment: 'Travelling with two teenagers who loved every minute. Elephant sanctuary was an absolute highlight. Book this!', isApproved: true, helpful: 14 },
      { packageId: N.pkg4, authorId: N.customer4,  name: 'Fatima Al-Hassan', email: 'fatima.hassan@outlook.com', rating: 5, comment: 'Dubai exceeded our wildest dreams. The desert safari was unforgettable and Burj Al Arab was simply magnificent.', isApproved: true, helpful: 22 },
      { packageId: N.pkg4, name: 'Richard Chen',   email: 'richard.c@gmail.com', rating: 4, comment: 'Exceptional service from start to finish. Only minor gripe was the Abu Dhabi day felt slightly rushed. Would still strongly recommend.', isApproved: true, helpful: 9 },
      { packageId: N.pkg5, authorId: N.customer1,  name: 'David Kumar', email: 'david.kumar@gmail.com', rating: 5, comment: 'Second honeymoon in Bali and it was even better than the first! The private villa with pool was heaven.', isApproved: true, helpful: 44 },
      { packageId: N.pkg5, name: 'Sophie Dubois',  email: 's.dubois@outlook.fr', rating: 5, comment: 'Magical in every sense. The water temple ceremony moved us both to tears. Nusa Penida is otherworldly.', isApproved: true, helpful: 27 },
      { packageId: N.pkg6, authorId: N.customer5,  name: 'James Wilson', email: 'james.wilson@yahoo.com', rating: 4, comment: 'Whistle-stop but the pacing was perfect. Paris was a highlight but honestly all four cities delivered. Rail connections were seamless.', isApproved: true, helpful: 11 },
      { packageId: N.pkg7, name: 'Aiko Watanabe',  email: 'aiko.w@docomo.jp', rating: 5, comment: 'As a Japanese national I was sceptical, but this tour showed me parts of my own country I\'d never seen. Outstanding curation.', isApproved: true, helpful: 19 },
    ],
    skipDuplicates: true,
  });
}

// ─── 3. Leads ─────────────────────────────────────────────────────────────────
async function seedLeads() {
  console.log('  → crm_leads (extended)');

  // Package selection ids — Lead's package association moved to a child
  // LeadPackageSelection row (see lead-service/prisma/schema.prisma), not a
  // direct scalar field on Lead, so each lead below points its
  // primarySelectionId at one of these.
  const SEL = {
    lead4: 'e1000000-0000-0000-0000-000000000004',
    lead5: 'e1000000-0000-0000-0000-000000000005',
    lead6: 'e1000000-0000-0000-0000-000000000006',
    lead7: 'e1000000-0000-0000-0000-000000000007',
    lead8: 'e1000000-0000-0000-0000-000000000008',
    lead9: 'e1000000-0000-0000-0000-000000000009',
    lead10: 'e1000000-0000-0000-0000-00000000000a',
    lead11: 'e1000000-0000-0000-0000-00000000000b',
    lead12: 'e1000000-0000-0000-0000-00000000000c',
  };

  const newLeads = [
    {
      id: N.lead4, name: 'Aisha Mohammed', email: 'aisha.m@gmail.com', phone: '+971505678901', city: 'Dubai',
      source: 'website', platform: 'Website_Form', fromCountry: 'UAE', destinationCountry: 'Maldives',
      destination: 'Maldives', travelDate: new Date('2025-06-10'), endDate: new Date('2025-06-14'),
      primarySelectionId: SEL.lead4,
      packageSelections: { create: [{ id: SEL.lead4, packageId: N.pkg5, packageName: 'Bali Honeymoon Bliss', isManual: false }] },
      numberOfTravelers: 2, budget: 'USD 5000', lifecycleStatus: 'DRAFTING', priority: 'high',
      assignedToId: N.salesRep3, assignedById: E.admin, assignmentMode: 'auto',
      tags: ['honeymoon','high-value','dubai'],
      remarks: { create: [{ text: 'Couple getting married in May, looking for June honeymoon options. Very interested in Bali or Maldives.', addedById: N.salesRep3 }] },
      statusHistory: { create: [{ status: 'new', changedById: E.admin, changedAt: new Date('2025-01-05') }, { status: 'contacted', changedById: N.salesRep3, changedAt: new Date('2025-01-06') }, { status: 'interested', changedById: N.salesRep3, changedAt: new Date('2025-01-07') }] },
      communicationLogs: { create: [{ type: 'call', notes: 'Discussed Bali vs Maldives. Customer leaning towards Maldives for exclusivity.', byId: N.salesRep3, date: new Date('2025-01-06') }] },
    },
    {
      id: N.lead5, name: 'Thomas Müller', email: 'thomas.muller@web.de', phone: '+4917612345678', city: 'Munich',
      source: 'referral', platform: 'Referral', fromCountry: 'Germany', destinationCountry: 'Thailand',
      destination: 'Thailand', travelDate: new Date('2025-07-15'), endDate: new Date('2025-07-20'),
      primarySelectionId: SEL.lead5,
      packageSelections: { create: [{ id: SEL.lead5, packageId: E.pkg3, packageName: 'Thailand Family Adventure', isManual: false }] },
      numberOfTravelers: 5, budget: 'EUR 8000', lifecycleStatus: 'QUOTED', priority: 'medium',
      assignedToId: N.salesRep4, assignedById: E.admin, assignmentMode: 'auto',
      followUpDate: new Date('2025-02-01'),
      tags: ['family','germany','summer'],
      remarks: { create: [{ text: 'Referred by previous client James T. Family of 5 with kids aged 6, 9, 14. Need child-friendly activities.', addedById: N.salesRep4 }, { text: 'Sent customized quote with early-bird summer pricing. Awaiting approval.', addedById: N.salesRep4, date: new Date('2025-01-15') }] },
      statusHistory: { create: [{ status: 'new', changedById: E.admin, changedAt: new Date('2025-01-08') }, { status: 'contacted', changedById: N.salesRep4, changedAt: new Date('2025-01-09') }, { status: 'interested', changedById: N.salesRep4, changedAt: new Date('2025-01-11') }, { status: 'quoted', changedById: N.salesRep4, changedAt: new Date('2025-01-14') }] },
      communicationLogs: { create: [{ type: 'email', notes: 'Sent detailed proposal with family-friendly hotel options and kids activity list.', byId: N.salesRep4, date: new Date('2025-01-14') }, { type: 'call', notes: 'Follow-up call — customer reviewing quote with wife. Decision by end of January.', byId: N.salesRep4, date: new Date('2025-01-20') }] },
    },
    {
      id: N.lead6, name: 'Priya Nair', email: 'priya.nair@gmail.com', phone: '+919876012345', city: 'Bangalore',
      source: 'facebook', platform: 'Facebook', fromCountry: 'India', destinationCountry: 'Sri Lanka',
      destination: 'Sri Lanka', travelDate: new Date('2025-08-20'), endDate: new Date('2025-08-24'),
      primarySelectionId: SEL.lead6,
      packageSelections: { create: [{ id: SEL.lead6, packageId: E.pkg1, packageName: 'Sri Lanka Heritage Explorer', isManual: false }] },
      numberOfTravelers: 2, budget: 'USD 2500', lifecycleStatus: 'NEW', priority: 'low',
      assignedToId: E.salesRep1, assignedById: E.admin, assignmentMode: 'auto',
      tags: ['india','couple','heritage'],
      remarks: { create: [] },
      statusHistory: { create: [{ status: 'new', changedById: E.admin, changedAt: new Date('2025-01-22') }] },
      communicationLogs: { create: [] },
    },
    {
      id: N.lead7, name: 'Carlos Mendoza', email: 'carlos.m@hotmail.com', phone: '+34912345678', city: 'Madrid',
      source: 'email', platform: 'Email', fromCountry: 'Spain', destinationCountry: 'Japan',
      destination: 'Japan', travelDate: new Date('2025-10-01'), endDate: new Date('2025-10-09'),
      primarySelectionId: SEL.lead7,
      packageSelections: { create: [{ id: SEL.lead7, packageId: N.pkg7, packageName: 'Japan Cultural Journey', isManual: false }] },
      numberOfTravelers: 3, budget: 'EUR 12000', lifecycleStatus: 'DRAFTING', priority: 'high',
      assignedToId: N.salesRep3, assignedById: E.admin, assignmentMode: 'auto',
      followUpDate: new Date('2025-02-10'), tags: ['spain','group','japan','autumn'],
      remarks: { create: [{ text: 'Group of 3 friends celebrating 10-year anniversary. Budget is flexible if package is exceptional.', addedById: N.salesRep3 }] },
      statusHistory: { create: [{ status: 'new', changedById: E.admin, changedAt: new Date('2025-01-18') }, { status: 'contacted', changedById: N.salesRep3, changedAt: new Date('2025-01-19') }, { status: 'interested', changedById: N.salesRep3, changedAt: new Date('2025-01-21') }] },
      communicationLogs: { create: [{ type: 'call', notes: 'Very enthusiastic about Japan trip. Specifically interested in Kyoto temples and Hakone onsen.', byId: N.salesRep3, date: new Date('2025-01-19') }] },
    },
    {
      id: N.lead8, name: 'Nguyen Van An', email: 'nguyen.van.an@vnn.vn', phone: '+84901234567', city: 'Ho Chi Minh City',
      source: 'website', platform: 'Website_Form', fromCountry: 'Vietnam', destinationCountry: 'Maldives',
      destination: 'Maldives', travelDate: new Date('2025-02-20'), endDate: new Date('2025-02-22'),
      primarySelectionId: SEL.lead8,
      packageSelections: { create: [{ id: SEL.lead8, packageId: E.pkg2, packageName: 'Maldives Luxury Escape', isManual: false }] },
      numberOfTravelers: 2, budget: 'USD 7000', lifecycleStatus: 'CONFIRMED', priority: 'high',
      assignedToId: N.salesRep4, assignedById: E.admin, assignmentMode: 'auto',
      convertedBookingId: N.booking3,
      tags: ['vietnam','honeymoon','converted'],
      remarks: { create: [{ text: 'Smooth conversion. Paid in full within 48 hours of receiving quote.', addedById: N.salesRep4 }] },
      statusHistory: { create: [
        { status: 'new', changedById: E.admin, changedAt: new Date('2025-01-10') },
        { status: 'contacted', changedById: N.salesRep4, changedAt: new Date('2025-01-10') },
        { status: 'quoted', changedById: N.salesRep4, changedAt: new Date('2025-01-11') },
        { status: 'converted', changedById: N.salesRep4, changedAt: new Date('2025-01-12') },
      ]},
      communicationLogs: { create: [{ type: 'email', notes: 'Sent quote — immediate positive response.', byId: N.salesRep4, date: new Date('2025-01-11') }] },
    },
    {
      id: N.lead9, name: 'Isabella Rossi', email: 'isabella.r@gmail.it', phone: '+393334567890', city: 'Milan',
      source: 'referral', platform: 'Referral', fromCountry: 'Italy', destinationCountry: 'Dubai',
      destination: 'Dubai', travelDate: new Date('2025-11-10'), endDate: new Date('2025-11-13'),
      primarySelectionId: SEL.lead9,
      packageSelections: { create: [{ id: SEL.lead9, packageId: N.pkg4, packageName: 'Dubai Luxury Experience', isManual: false }] },
      numberOfTravelers: 2, budget: 'USD 6000', lifecycleStatus: 'QUOTED', priority: 'medium',
      assignedToId: E.salesRep2, assignedById: N.admin2, assignmentMode: 'manual',
      followUpDate: new Date('2025-02-15'),
      tags: ['italy','couple','dubai','winter'],
      remarks: { create: [{ text: 'Luxury shopper — interested in Dubai for the shopping festival as well as the sights.', addedById: E.salesRep2 }] },
      statusHistory: { create: [{ status: 'new', changedById: N.admin2, changedAt: new Date('2025-01-20') }, { status: 'contacted', changedById: E.salesRep2, changedAt: new Date('2025-01-21') }, { status: 'interested', changedById: E.salesRep2, changedAt: new Date('2025-01-23') }, { status: 'quoted', changedById: E.salesRep2, changedAt: new Date('2025-01-25') }] },
      communicationLogs: { create: [{ type: 'call', notes: 'Discussed November dates around Shopping Festival. Sent customised quote.', byId: E.salesRep2, date: new Date('2025-01-21') }, { type: 'email', notes: 'Quote sent with hotel upgrade options.', byId: E.salesRep2, date: new Date('2025-01-25') }] },
    },
    {
      id: N.lead10, name: 'Oliver Thompson', email: 'oliver.t@gmail.com', phone: '+61412345678', city: 'Sydney',
      source: 'website', platform: 'Website_Form', fromCountry: 'Australia', destinationCountry: 'Europe',
      destination: 'Europe', travelDate: new Date('2025-09-01'), endDate: new Date('2025-09-07'),
      primarySelectionId: SEL.lead10,
      packageSelections: { create: [{ id: SEL.lead10, packageId: N.pkg6, packageName: 'European Grand Tour', isManual: false }] },
      numberOfTravelers: 4, budget: 'USD 18000', lifecycleStatus: 'DRAFTING', priority: 'high',
      assignedToId: N.salesRep3, assignedById: E.admin, assignmentMode: 'auto',
      tags: ['australia','family','europe'],
      remarks: { create: [{ text: 'Family of 4 — couple + 2 uni-age kids. First Europe trip. Budget very flexible.', addedById: N.salesRep3 }] },
      statusHistory: { create: [{ status: 'new', changedById: E.admin, changedAt: new Date('2025-01-25') }, { status: 'contacted', changedById: N.salesRep3, changedAt: new Date('2025-01-26') }, { status: 'interested', changedById: N.salesRep3, changedAt: new Date('2025-01-28') }] },
      communicationLogs: { create: [{ type: 'call', notes: 'Enthusiastic family. Want to add Barcelona extension.', byId: N.salesRep3, date: new Date('2025-01-26') }] },
    },
    {
      id: N.lead11, name: 'Hiroshi Yamamoto', email: 'h.yamamoto@softbank.jp', phone: '+81901234567', city: 'Tokyo',
      source: 'phone_call', platform: 'Phone_Call', fromCountry: 'Japan', destinationCountry: 'Sri Lanka',
      destination: 'Sri Lanka', travelDate: new Date('2025-03-20'), endDate: new Date('2025-03-24'),
      primarySelectionId: SEL.lead11,
      packageSelections: { create: [{ id: SEL.lead11, packageId: E.pkg1, packageName: 'Sri Lanka Heritage Explorer', isManual: false }] },
      numberOfTravelers: 1, budget: 'USD 2000', lifecycleStatus: 'CLOSED_LOST', priority: 'low',
      assignedToId: E.salesRep1, assignedById: E.admin, assignmentMode: 'auto',
      lostReason: 'Booked directly with a competitor offering a lower price.',
      tags: ['japan','solo','lost'],
      remarks: { create: [{ text: 'Lost to competitor. Price sensitive despite being solo traveller.', addedById: E.salesRep1 }] },
      statusHistory: { create: [{ status: 'new', changedById: E.admin, changedAt: new Date('2025-01-12') }, { status: 'contacted', changedById: E.salesRep1, changedAt: new Date('2025-01-13') }, { status: 'quoted', changedById: E.salesRep1, changedAt: new Date('2025-01-14') }, { status: 'lost', changedById: E.salesRep1, changedAt: new Date('2025-01-18'), notes: 'Competitor undercut by 15%' }] },
      communicationLogs: { create: [{ type: 'call', notes: 'Price negotiation failed. Customer went with competitor.', byId: E.salesRep1, date: new Date('2025-01-18') }] },
    },
    {
      id: N.lead12, name: 'Amara Osei', email: 'amara.osei@yahoo.com', phone: '+233244123456', city: 'Accra',
      source: 'facebook', platform: 'Facebook', fromCountry: 'Ghana', destinationCountry: 'Maldives',
      destination: 'Maldives', travelDate: new Date('2025-12-25'), endDate: new Date('2025-12-31'),
      primarySelectionId: SEL.lead12,
      packageSelections: { create: [{ id: SEL.lead12, packageId: N.pkg5, packageName: 'Bali Honeymoon Bliss', isManual: false }] },
      numberOfTravelers: 2, budget: 'USD 5500', lifecycleStatus: 'NEW', priority: 'medium',
      assignedToId: N.salesRep4, assignedById: E.admin, assignmentMode: 'auto',
      tags: ['ghana','christmas','honeymoon'],
      remarks: { create: [] },
      statusHistory: { create: [{ status: 'new', changedById: E.admin, changedAt: new Date('2025-01-28') }] },
      communicationLogs: { create: [] },
    },
  ];

  for (const lead of newLeads) {
    await leads.lead.upsert({ where: { id: lead.id }, update: {}, create: lead });
  }
}

// ─── 4. Bookings ──────────────────────────────────────────────────────────────
async function seedBookings() {
  console.log('  → crm_bookings (extended)');

  const newBookings = [
    {
      id: N.booking3, userId: N.customer4, packageId: E.pkg2, invoiceId: N.invoice3,
      assignedToId: N.salesRep4, travelDate: new Date('2025-02-20'), endDate: new Date('2025-02-22'),
      numberOfTravelers: 2, totalAmount: 7000, paidAmount: 7000, paymentStatus: 'paid', bookingStatus: 'confirmed',
      specialRequests: 'Honeymoon setup — flower petals and complimentary sparkling water.',
      confirmedAt: new Date('2025-01-12'),
      travelers: { create: [{ name: 'Nguyen Van An', age: 30, gender: 'male', idType: 'passport', idNumber: 'B9876543' }, { name: 'Tran Thi Lan', age: 27, gender: 'female', idType: 'passport', idNumber: 'B1234567' }] },
    },
    {
      id: N.booking4, userId: N.customer3, packageId: N.pkg4, invoiceId: N.invoice4,
      assignedToId: N.salesRep3, travelDate: new Date('2025-03-15'), endDate: new Date('2025-03-18'),
      numberOfTravelers: 2, totalAmount: 5600, paidAmount: 2800, paymentStatus: 'partial', bookingStatus: 'confirmed',
      specialRequests: 'Vegetarian meals where possible. No pork.',
      confirmedAt: new Date('2025-01-26'),
      travelers: { create: [{ name: 'Arjun Sharma', age: 34, gender: 'male', idType: 'passport', idNumber: 'P1234567' }, { name: 'Meena Sharma', age: 31, gender: 'female', idType: 'passport', idNumber: 'P7654321' }] },
    },
    {
      id: N.booking5, userId: N.customer5, packageId: N.pkg6, assignedToId: N.salesRep3,
      travelDate: new Date('2025-09-01'), endDate: new Date('2025-09-07'),
      numberOfTravelers: 4, totalAmount: 18000, paidAmount: 5400, paymentStatus: 'partial', bookingStatus: 'pending',
      specialRequests: 'One guest has a nut allergy. Please inform all hotels.',
      travelers: { create: [
        { name: 'Oliver Thompson', age: 47, gender: 'male', idType: 'passport', idNumber: 'AU123456' },
        { name: 'Sarah Thompson',  age: 44, gender: 'female', idType: 'passport', idNumber: 'AU654321' },
        { name: 'Jack Thompson',   age: 21, gender: 'male', idType: 'passport', idNumber: 'AU111222' },
        { name: 'Emma Thompson',   age: 19, gender: 'female', idType: 'passport', idNumber: 'AU333444' },
      ]},
    },
  ];

  for (const b of newBookings) {
    await books.booking.upsert({ where: { id: b.id }, update: {}, create: b });
  }
}

// ─── 5. Billing ───────────────────────────────────────────────────────────────
async function seedBilling() {
  console.log('  → crm_billing (extended)');

  // Invoice 3 — Nguyen booking (paid)
  await bill.invoice.upsert({
    where: { id: N.invoice3 }, update: {},
    create: {
      id: N.invoice3, invoiceNumber: 'INV-202501-00003', leadId: N.lead8, bookingId: N.booking3,
      createdById: N.salesRep4, customerName: 'Nguyen Van An', customerEmail: 'nguyen.van.an@vnn.vn',
      customerPhone: '+84901234567', customerAddress: 'Ho Chi Minh City, Vietnam',
      type: 'invoice', subtotal: 7000, taxRate: 0, taxAmount: 0,
      discountType: 'none', discountValue: 0, discountAmount: 0, totalAmount: 7000,
      paidAmount: 7000, outstandingAmount: 0, status: 'paid', paymentStatus: 'paid',
      dueDate: new Date('2025-01-20'), issueDate: new Date('2025-01-11'), paidDate: new Date('2025-01-12'),
      emailSent: true, sentAt: new Date('2025-01-11'),
      items: { create: [
        { description: 'Maldives Luxury Escape — 2 persons (3 nights)', category: 'package', quantity: 1, unitPrice: 7000, totalPrice: 7000, order: 0 },
      ]},
    },
  });

  // Invoice 4 — Arjun Dubai (partial)
  await bill.invoice.upsert({
    where: { id: N.invoice4 }, update: {},
    create: {
      id: N.invoice4, invoiceNumber: 'INV-202501-00004', leadId: N.lead4, bookingId: N.booking4,
      createdById: N.salesRep3, customerName: 'Arjun Sharma', customerEmail: 'arjun.sharma@gmail.com',
      customerPhone: '+919812345678', type: 'invoice',
      subtotal: 5600, taxRate: 5, taxAmount: 280, discountType: 'fixed', discountValue: 300, discountAmount: 300,
      totalAmount: 5580, paidAmount: 2800, outstandingAmount: 2780,
      status: 'partial', paymentStatus: 'partial',
      dueDate: new Date('2025-03-01'), issueDate: new Date('2025-01-26'), emailSent: true, sentAt: new Date('2025-01-26'),
      items: { create: [
        { description: 'Dubai Luxury Experience — 2 persons (4 nights)', category: 'package', quantity: 1, unitPrice: 5600, totalPrice: 5600, order: 0 },
      ]},
    },
  });

  // Invoice 5 — Oliver Europe (draft, large group)
  await bill.invoice.upsert({
    where: { id: N.invoice5 }, update: {},
    create: {
      id: N.invoice5, invoiceNumber: 'INV-202501-00005', leadId: N.lead10,
      createdById: N.salesRep3, customerName: 'Oliver Thompson', customerEmail: 'oliver.t@gmail.com',
      customerPhone: '+61412345678', type: 'proforma',
      subtotal: 18000, taxRate: 0, taxAmount: 0, discountType: 'percentage', discountValue: 5, discountAmount: 900,
      totalAmount: 17100, paidAmount: 5130, outstandingAmount: 11970,
      status: 'partial', paymentStatus: 'partial',
      dueDate: new Date('2025-08-01'), issueDate: new Date('2025-01-28'),
      notes: 'Group booking — 30% deposit received. Balance due 30 days before departure.',
      emailSent: true, sentAt: new Date('2025-01-28'),
      items: { create: [
        { description: 'European Grand Tour — 4 persons (7 nights)', category: 'package', quantity: 4, unitPrice: 4500, totalPrice: 18000, order: 0 },
      ]},
    },
  });

  // Invoice 6 — Priya Sri Lanka (sent, awaiting first payment)
  await bill.invoice.upsert({
    where: { id: N.invoice6 }, update: {},
    create: {
      id: N.invoice6, invoiceNumber: 'INV-202501-00006', leadId: N.lead6,
      createdById: E.salesRep1, customerName: 'Priya Nair', customerEmail: 'priya.nair@gmail.com',
      customerPhone: '+919876012345', customerAddress: 'Bangalore, India', type: 'invoice',
      subtotal: 2500, taxRate: 0, taxAmount: 0, discountType: 'none', discountValue: 0, discountAmount: 0,
      totalAmount: 2500, paidAmount: 0, outstandingAmount: 2500,
      status: 'sent', paymentStatus: 'unpaid',
      dueDate: new Date('2025-02-28'), issueDate: new Date('2025-01-30'),
      emailSent: true, sentAt: new Date('2025-01-30'),
      items: { create: [
        { description: 'Sri Lanka Heritage Explorer — 2 persons (4 nights)', category: 'package', quantity: 1, unitPrice: 2500, totalPrice: 2500, order: 0 },
      ]},
    },
  });

  // Quotation 2 — Thomas Germany family
  await bill.quotation.upsert({
    where: { id: N.quotation2 }, update: {},
    create: {
      id: N.quotation2, quotationNumber: 'QT-202501-00002', leadId: N.lead5,
      createdById: N.salesRep4, customerName: 'Thomas Müller', customerEmail: 'thomas.muller@web.de',
      customerPhone: '+4917612345678', type: 'package_based', mode: 'detailed',
      packageId: E.pkg3,
      subtotal: 9000, taxRate: 0, taxAmount: 0, discountType: 'fixed', discountValue: 100, discountAmount: 100,
      totalAmount: 8900, status: 'sent',
      issueDate: new Date('2025-01-14'), validUntil: new Date('2025-02-14'),
      emailSent: true, sentAt: new Date('2025-01-14'), version: 1,
      includedServices: ['Hotels (5 nights)','Airport transfers','All guided tours','Daily breakfast & dinner','Elephant sanctuary entry'],
      excludedServices: ['International flights','Lunch','Travel insurance','Personal expenses'],
      items: { create: [
        { description: 'Thailand Family Adventure — 2 adults + 3 children', category: 'package', quantity: 5, unitPrice: 1800, totalPrice: 9000, order: 0 },
      ]},
      revisionHistory: { create: [{ version: 1, modifiedById: N.salesRep4, changes: JSON.stringify({ note: 'Initial quote' }) }] },
    },
  });

  // Quotation 3 — Isabella Dubai
  await bill.quotation.upsert({
    where: { id: N.quotation3 }, update: {},
    create: {
      id: N.quotation3, quotationNumber: 'QT-202501-00003', leadId: N.lead9,
      createdById: E.salesRep2, customerName: 'Isabella Rossi', customerEmail: 'isabella.r@gmail.it',
      customerPhone: '+393334567890', type: 'package_based', mode: 'detailed',
      packageId: N.pkg4,
      subtotal: 5600, taxRate: 5, taxAmount: 280, discountType: 'none', discountValue: 0, discountAmount: 0,
      totalAmount: 5880, status: 'viewed',
      issueDate: new Date('2025-01-25'), validUntil: new Date('2025-02-25'),
      emailSent: true, sentAt: new Date('2025-01-25'), viewedAt: new Date('2025-01-26'), version: 1,
      includedServices: ['5-star hotel (4 nights)','All transfers','Desert safari','Burj Khalifa','Abu Dhabi trip'],
      excludedServices: ['International flights','Personal shopping','Travel insurance'],
      items: { create: [
        { description: 'Dubai Luxury Experience — 2 persons', category: 'package', quantity: 1, unitPrice: 5600, totalPrice: 5600, order: 0 },
      ]},
      images: { create: [{ url: 'https://picsum.photos/seed/dubai/800/500', isCover: true }] },
      revisionHistory: { create: [{ version: 1, modifiedById: E.salesRep2, changes: JSON.stringify({ note: 'Added hotel upgrade note' }) }] },
    },
  });

  // Receipt 2 — Nguyen full payment
  await bill.paymentReceipt.upsert({
    where: { id: N.receipt2 }, update: {},
    create: {
      id: N.receipt2, receiptNumber: 'REC-202501-00002', leadId: N.lead8, invoiceId: N.invoice3,
      createdById: N.salesRep4, customerName: 'Nguyen Van An', customerEmail: 'nguyen.van.an@vnn.vn',
      customerPhone: '+84901234567', amount: 7000, currency: 'USD',
      paymentMethod: 'card', paymentDate: new Date('2025-01-12'), transactionId: 'stripe_pi_4QDef456abc',
      receiptStatus: 'paid_in_full', paymentType: 'full_payment',
      previousBalance: 7000, outstandingBalance: 0,
      cardType: 'mastercard', cardLastFour: '5500', paymentGateway: 'stripe',
      gatewayTransactionId: 'pi_4QDef456abc',
      verified: true, verifiedById: N.admin2, verifiedAt: new Date('2025-01-12'),
      emailSent: true, sentAt: new Date('2025-01-12'),
      paymentHistories: { create: [{
        paymentHistoryNumber: 'PH-202501-00002', leadId: N.lead8, invoiceId: N.invoice3,
        customerName: 'Nguyen Van An', customerEmail: 'nguyen.van.an@vnn.vn',
        amount: 7000, currency: 'USD', paymentMethod: 'card', paymentDate: new Date('2025-01-12'),
        transactionId: 'stripe_pi_4QDef456abc', paymentType: 'full_payment', status: 'verified',
        createdById: N.salesRep4, verifiedById: N.admin2, verifiedAt: new Date('2025-01-12'),
      }]},
    },
  });

  // Receipt 3 — Arjun deposit
  await bill.paymentReceipt.upsert({
    where: { id: N.receipt3 }, update: {},
    create: {
      id: N.receipt3, receiptNumber: 'REC-202501-00003', leadId: N.lead4, invoiceId: N.invoice4,
      createdById: N.salesRep3, customerName: 'Arjun Sharma', customerEmail: 'arjun.sharma@gmail.com',
      customerPhone: '+919812345678', amount: 2800, currency: 'USD',
      paymentMethod: 'bank_transfer', paymentDate: new Date('2025-01-27'), transactionId: 'HDFC-TXN-789012',
      receiptStatus: 'partial_payment', paymentType: 'advance',
      previousBalance: 5580, outstandingBalance: 2780,
      bankName: 'HDFC Bank', bankAccountNumber: '****1234', bankTransactionRef: 'HDFC-TXN-789012',
      verified: false,
      emailSent: true, sentAt: new Date('2025-01-27'),
      paymentHistories: { create: [{
        paymentHistoryNumber: 'PH-202501-00003', leadId: N.lead4, invoiceId: N.invoice4,
        customerName: 'Arjun Sharma', customerEmail: 'arjun.sharma@gmail.com',
        amount: 2800, currency: 'USD', paymentMethod: 'bank_transfer', paymentDate: new Date('2025-01-27'),
        transactionId: 'HDFC-TXN-789012', paymentType: 'advance', status: 'pending',
        createdById: N.salesRep3,
      }]},
    },
  });

  // Credit Note 1 — partial refund on lead2's invoice
  await bill.creditNote.upsert({
    where: { id: N.creditNote1 }, update: {},
    create: {
      id: N.creditNote1, creditNoteNumber: 'CN-202501-00001', leadId: E.lead2, invoiceId: E.invoice2,
      createdById: E.salesRep2, customerName: 'Rajesh Nair', customerEmail: 'rajesh.nair@outlook.com',
      customerPhone: '+919876543210', customerAddress: 'Mumbai, India',
      type: 'discount', reason: 'Early booking promotional discount applied post-quotation.',
      subtotal: 200, taxAmount: 0, totalAmount: 200,
      status: 'issued', refundStatus: 'not_applicable',
      appliedToInvoice: true, appliedAt: new Date('2025-01-22'),
      voucherGenerated: false, issueDate: new Date('2025-01-22'),
      approvalRequired: true, approvedById: N.admin2, approvedAt: new Date('2025-01-22'),
      emailSent: true, sentAt: new Date('2025-01-22'),
      items: { create: [{ description: 'Early booking promotional discount — applied retroactively', originalAmount: 200, creditAmount: 200, quantity: 1, order: 0 }] },
    },
  });

  // Voucher 1 — Maldives trip for David Kumar (booking1)
  await bill.voucher.upsert({
    where: { id: N.voucher1 }, update: {},
    create: {
      id: N.voucher1, voucherNumber: 'VCH-202412-00001', leadId: E.lead1, packageId: E.pkg2,
      createdById: E.salesRep1, customerName: 'David Kumar', customerEmail: 'david.kumar@gmail.com',
      customerPhone: '+94771234567',
      packageDetails: { name: 'Maldives Luxury Escape', destination: 'Maldives', duration: 3, category: 'honeymoon', price: 7000, inclusions: ['Seaplane transfers','Overwater villa','All-inclusive meals','Two diving sessions','Sunset cruise'], coverImage: { url: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=800' } },
      travelStartDate: new Date('2025-02-14'), travelEndDate: new Date('2025-02-17'),
      notes: 'Honeymoon package — Valentine\'s Day special. Room decorated on arrival.',
      terms: ['Check-in after 14:00', 'Check-out before 12:00', 'Seaplane operates 06:00–17:00 only', 'Diving sessions pre-booked; subject to weather'],
      specialInstructions: 'Present this voucher at the resort reception. Seaplane boarding pass will be emailed separately.',
      status: 'confirmed', emailSent: true, emailSentAt: new Date('2024-12-11'), confirmedAt: new Date('2024-12-12'),
      locationDates: { create: [{ location: 'North Malé Atoll, Maldives', hotelName: 'Soneva Jani Resort', checkIn: new Date('2025-02-14'), checkOut: new Date('2025-02-17'), order: 0 }] },
      mealPlans: { create: [
        { dayNumber: 1, dayTitle: 'Arrival Day',      breakfast: false, lunch: true,  dinner: true },
        { dayNumber: 2, dayTitle: 'Full Day at Resort', breakfast: true,  lunch: true,  dinner: true },
        { dayNumber: 3, dayTitle: 'Departure Day',    breakfast: true,  lunch: false, dinner: false },
      ]},
      itinerarySummary: { create: [
        { dayNumber: 1, title: 'Arrival & Welcome',     locations: ['Malé','North Malé Atoll'], activities: ['Seaplane transfer','Snorkelling orientation'], accommodationName: 'Soneva Jani', accommodationType: 'water villa', order: 0 },
        { dayNumber: 2, title: 'Reef Exploration',      locations: ['House Reef'],              activities: ['Scuba diving','Dolphin watching','Sunset cruise'],  accommodationName: 'Soneva Jani', accommodationType: 'water villa', order: 1 },
        { dayNumber: 3, title: 'Farewell & Departure',  locations: ['Malé'],                    activities: ['Island shopping'],                                 accommodationName: null, order: 2 },
      ]},
    },
  });

  // Voucher 2 — Nguyen Maldives booking
  await bill.voucher.upsert({
    where: { id: N.voucher2 }, update: {},
    create: {
      id: N.voucher2, voucherNumber: 'VCH-202501-00002', leadId: N.lead8, packageId: E.pkg2,
      createdById: N.salesRep4, customerName: 'Nguyen Van An', customerEmail: 'nguyen.van.an@vnn.vn',
      packageDetails: { name: 'Maldives Luxury Escape', destination: 'Maldives', duration: 3, price: 7000 },
      travelStartDate: new Date('2025-02-20'), travelEndDate: new Date('2025-02-22'),
      terms: ['Check-in after 14:00','Seaplane schedule subject to weather'],
      status: 'sent', emailSent: true, emailSentAt: new Date('2025-01-13'),
      locationDates: { create: [{ location: 'North Malé Atoll, Maldives', hotelName: 'Soneva Jani Resort', checkIn: new Date('2025-02-20'), checkOut: new Date('2025-02-22'), order: 0 }] },
      mealPlans: { create: [
        { dayNumber: 1, dayTitle: 'Arrival',    breakfast: false, lunch: true,  dinner: true },
        { dayNumber: 2, dayTitle: 'Full Day',   breakfast: true,  lunch: true,  dinner: true },
        { dayNumber: 3, dayTitle: 'Departure',  breakfast: true,  lunch: false, dinner: false },
      ]},
      itinerarySummary: { create: [
        { dayNumber: 1, title: 'Arrival',     locations: ['Malé','North Malé Atoll'], activities: ['Seaplane transfer'],  accommodationName: 'Soneva Jani', order: 0 },
        { dayNumber: 2, title: 'Beach Day',   locations: ['House Reef'],              activities: ['Diving','Snorkelling'], accommodationName: 'Soneva Jani', order: 1 },
        { dayNumber: 3, title: 'Departure',   locations: ['Malé'],                    activities: ['Island shopping'],     accommodationName: null, order: 2 },
      ]},
    },
  });
}

// ─── 6. Careers ───────────────────────────────────────────────────────────────
async function seedCareers() {
  console.log('  → crm_careers (extended)');

  await career.vacancy.createMany({
    data: [
      { position: 'Customer Relations Manager', description: 'Lead our customer experience team, handling VIP client relationships, resolving escalations, and developing service standards across the travel division.', type: 'Full_Time', location: 'Colombo, Sri Lanka', experienceMin: 5, status: 'active', createdById: E.admin, closingDate: new Date('2025-03-15') },
      { position: 'Travel Operations Coordinator', description: 'Coordinate day-to-day travel operations including hotel bookings, transfers, and vendor communication. Strong organisational skills and knowledge of GDS systems required.', type: 'Full_Time', location: 'Colombo, Sri Lanka', experienceMin: 2, status: 'active', createdById: N.admin2, closingDate: new Date('2025-02-28') },
      { position: 'Junior Travel Consultant', description: 'Entry-level role for recent graduates passionate about travel. Full training provided. You will assist senior consultants in building and selling travel packages.', type: 'Full_Time', location: 'Colombo, Sri Lanka', experienceMin: 0, status: 'active', createdById: E.admin, closingDate: new Date('2025-03-31') },
      { position: 'Social Media & Content Creator', description: 'Create compelling travel content across Instagram, TikTok, Facebook and YouTube. Video editing, Canva, and drone footage experience a strong plus.', type: 'Part_Time', location: 'Remote', experienceMin: 1, status: 'active', createdById: N.admin2, closingDate: new Date('2025-02-20') },
      { position: 'Finance & Billing Executive', description: 'Manage invoicing, receipts, payment reconciliation and financial reporting for our travel CRM. Experience with accounting software required.', type: 'Full_Time', location: 'Colombo, Sri Lanka', experienceMin: 3, status: 'draft', createdById: E.admin },
    ],
    skipDuplicates: true,
  });

  await career.career.createMany({
    data: [
      { fullName: 'Samantha Perera', email: 'samantha.p@gmail.com', phone: '+94712345678', position: 'Senior Travel Consultant', coverLetter: 'I bring 7 years of high-end travel consultancy experience from Aman Resorts and Abercrombie & Kent. My specialty is crafting bespoke luxury itineraries for the UHNW segment. I am excited to bring this expertise to your growing CRM-powered travel business.', agreeTerms: true, status: 'hired', reviewedById: E.admin, reviewedAt: new Date('2024-12-28'), emailSent: true, adminNotes: 'Exceptional candidate. Strong luxury segment experience. Offer extended.' },
      { fullName: 'Dinesh Wickramasinghe', email: 'dinesh.w@outlook.com', phone: '+94723456789', position: 'Digital Marketing Executive', coverLetter: 'As a performance marketing specialist with 4 years in the travel and hospitality sector, I have managed Google Ads and Meta campaigns consistently delivering ROAS of 5x or above. I hold Google Ads certification and have worked with booking.com\'s affiliate programme.', agreeTerms: true, status: 'under_review', reviewedById: N.admin2, reviewedAt: new Date('2025-01-10'), emailSent: true, adminNotes: 'Strong technical skills. Portfolio impressive. Schedule final interview.' },
      { fullName: 'Anushka Fernando', email: 'anushka.f@yahoo.com', phone: '+94734567890', position: 'Customer Relations Manager', coverLetter: 'With a decade in five-star hotel management at Shangri-La and Cinnamon Grand, I have built and led customer experience teams of up to 25 people. I am passionate about creating seamless guest journeys and resolving issues before they escalate.', agreeTerms: true, status: 'shortlisted', reviewedById: E.admin, reviewedAt: new Date('2025-01-18'), emailSent: true, adminNotes: 'Hotel background translates well. Shortlisted for panel interview.' },
      { fullName: 'Mohammed Al-Rashid', email: 'm.alrashid@gmail.com', phone: '+971501234567', position: 'Senior Travel Consultant', coverLetter: 'Based in Dubai with 6 years consulting for high-net-worth Gulf clients, I specialise in luxury packages to the Maldives, Europe and Far East. I am bilingual in Arabic and English.', agreeTerms: true, status: 'shortlisted', reviewedById: N.admin2, reviewedAt: new Date('2025-01-20'), emailSent: true, adminNotes: 'Arabic-English bilingual — valuable for UAE market. Strong client list.' },
      { fullName: 'Kavitha Subramaniam', email: 'kavitha.s@gmail.com', phone: '+919876501234', position: 'Travel Operations Coordinator', coverLetter: 'I have 3 years of travel operations experience using Amadeus GDS at Thomas Cook India. I am proficient in hotel and transfer coordination, vendor communication and IATA ticketing.', agreeTerms: true, status: 'pending', emailSent: false },
      { fullName: 'Lucas Andersen', email: 'l.andersen@gmail.dk', phone: '+4589012345', position: 'Social Media & Content Creator', coverLetter: 'I am a professional travel content creator with 45k Instagram followers and experience shooting drone footage across Southeast Asia. I have created content for Airbnb Experiences and several boutique tour operators in Scandinavia.', agreeTerms: true, status: 'pending', emailSent: false },
      { fullName: 'Iresha Madushani', email: 'iresha.m@gmail.com', phone: '+94745678901', position: 'Junior Travel Consultant', coverLetter: 'I am a recent HND graduate in Tourism Management from SLITHM. I completed a 6-month internship at Aitken Spence Travels and have a genuine passion for helping people plan memorable journeys.', agreeTerms: true, status: 'pending', emailSent: false },
      { fullName: 'Rajan Krishnamurthy', email: 'rajan.k@outlook.in', phone: '+919123456780', position: 'Finance & Billing Executive', coverLetter: 'I am a CA intermediate with 4 years\' experience in travel industry finance at MakeMyTrip. Proficient in Tally, QuickBooks and advanced Excel. Ready to bring rigorous financial discipline to your billing operations.', agreeTerms: true, status: 'rejected', reviewedById: E.admin, reviewedAt: new Date('2025-01-15'), emailSent: true, adminNotes: 'Position on hold; candidate informed. May reconsider when role opens.' },
    ],
    skipDuplicates: true,
  });
}

// ─── 7. Auth OTPs ─────────────────────────────────────────────────────────────
async function seedAuth() {
  console.log('  → crm_auth (extended)');
  await auth.otp.createMany({
    data: [
      { userId: N.customer3, code: '123456', type: 'emailVerification', email: 'arjun.sharma@gmail.com',  isUsed: false, attempts: 0, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      { userId: N.customer5, code: '654321', type: 'emailVerification', email: 'james.wilson@yahoo.com',  isUsed: false, attempts: 0, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      { userId: N.salesRep3, code: '789012', type: 'login',             email: 'diana.sales@travelcrm.com', isUsed: false, attempts: 0, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    ],
    skipDuplicates: true,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Extended seed — Travel CRM database\n');
  try {
    await seedUsers();
    await seedPackages();
    await seedLeads();
    await seedBookings();
    await seedBilling();
    await seedCareers();
    await seedAuth();
    console.log('\n✓ Extended seed completed successfully.');
  } catch (err) {
    console.error('\n✗ Seed failed:', err.message);
    throw err;
  } finally {
    await Promise.all([auth.$disconnect(), users.$disconnect(), pkg.$disconnect(), leads.$disconnect(), books.$disconnect(), bill.$disconnect(), career.$disconnect()]);
  }
}

main();
