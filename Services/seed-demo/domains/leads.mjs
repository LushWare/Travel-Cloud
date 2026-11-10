/**
 * crm_leads — the working book of business.
 *
 * Every lead is built as one coherent story rather than a row with children
 * bolted on: the lifecycle status determines which children exist. A NEW lead
 * has a pristine selection and no pricing (the UI derives a preview); a
 * DRAFTING lead has a copied itinerary and costed pricing; a QUOTED lead has a
 * quotation pointer; a CONFIRMED lead has a booking and an accepted quote.
 * Later steps (quotations, bookings, invoices) rely on that shape.
 *
 * Rows are materialised in memory first and written with createMany, because
 * cross-schema children reference ids this module mints itself — the same
 * deterministic ids the reset helper later recognises.
 */
import { COMMUNICATION_NOTES, INQUIRY_MESSAGES, LEAD_REMARKS, LOST_REASONS, SPECIAL_REQUESTS } from '../lib/fixtures.mjs';
import { addDays, isoDay, money } from '../lib/rng.mjs';
import { id as idFor } from '../lib/ids.mjs';
import { requireTenantId } from '../../shared/tenancy/src/index.js';

/** How many leads of each lifecycle state to build. */
const MIX = {
  PENDING_VERIFICATION: 6,
  NEW: 40,
  DRAFTING: 30,
  QUOTED: 22,
  REVISION: 6,
  APPROVED: 10,
  BOOKING_IN_PROGRESS: 6,
  CONFIRMED: 14,
  CLOSED_LOST: 12,
  BOOKING_FAILED: 3,
  CANCELLED: 3,
};

/** Statuses that have crossed the "blueprint copied into lead-owned rows" line. */
const HAS_ITINERARY = new Set(['DRAFTING', 'QUOTED', 'REVISION', 'APPROVED', 'BOOKING_IN_PROGRESS', 'CONFIRMED', 'BOOKING_FAILED', 'CANCELLED']);
/** Statuses whose selection has a costing the rep has actually worked on. */
const HAS_PRICING = HAS_ITINERARY;

const STATUS_PATH = {
  PENDING_VERIFICATION: ['PENDING_VERIFICATION'],
  NEW: ['NEW'],
  DRAFTING: ['NEW', 'DRAFTING'],
  QUOTED: ['NEW', 'DRAFTING', 'QUOTED'],
  REVISION: ['NEW', 'DRAFTING', 'QUOTED', 'REVISION'],
  APPROVED: ['NEW', 'DRAFTING', 'QUOTED', 'APPROVED'],
  BOOKING_IN_PROGRESS: ['NEW', 'DRAFTING', 'QUOTED', 'APPROVED', 'BOOKING_IN_PROGRESS'],
  CONFIRMED: ['NEW', 'DRAFTING', 'QUOTED', 'APPROVED', 'BOOKING_IN_PROGRESS', 'CONFIRMED'],
  CLOSED_LOST: ['NEW', 'DRAFTING', 'QUOTED', 'CLOSED_LOST'],
  BOOKING_FAILED: ['NEW', 'DRAFTING', 'QUOTED', 'APPROVED', 'BOOKING_FAILED'],
  CANCELLED: ['NEW', 'DRAFTING', 'QUOTED', 'APPROVED', 'BOOKING_IN_PROGRESS', 'CONFIRMED', 'CANCELLED'],
};

const SOURCES = [
  ['website', 'Website_Form', 26],
  ['booking', 'Paid_Package', 6],
  // 'social_media' was split into facebook and instagram (lead-service migration 20261018000000).
  ['facebook', 'Facebook', 8],
  ['instagram', 'Instagram', 6],
  ['phone_call', 'Phone_Call', 12],
  ['email', 'Email', 10],
  ['referral', 'Referral', 8],
  ['walk_in', 'Walk_in', 5],
  ['chatbot', 'Chatbot_Wizard', 9],
  ['voice_agent', 'Voice_Agent', 6],
  ['manual', 'Manual_Entry', 4],
];

const PLATFORM_FOR_SOURCE = Object.fromEntries(SOURCES.map(([s, p]) => [s, p]));

export async function seed(ctx) {
  const { db, ids, now, log } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('leads');
  const { reps, admins, customers } = ctx.data.users;
  const packages = ctx.data.packages.list.filter((p) => p.durationDays > 0);

  if (!packages.length) throw new Error('leads: no packages available — run the packages step first');

  // Package itineraries are read once and cloned per lead, so a lead's copied
  // days carry the same day titles, hotels and excursion costs as the
  // blueprint they came from.
  const itineraryCache = new Map();
  async function packageItinerary(packageId) {
    if (itineraryCache.has(packageId)) return itineraryCache.get(packageId);
    const days = await db.pkg.itineraryDay.findMany({
      where: { packageId },
      orderBy: { dayNumber: 'asc' },
      include: {
        places: { include: { place: true }, orderBy: { orderIndex: 'asc' } },
        activities: { include: { activity: true }, orderBy: { orderIndex: 'asc' } },
        transports: { include: { originPlace: true, destinationPlace: true } },
      },
    });
    itineraryCache.set(packageId, days);
    return days;
  }

  // ── Build the in-memory dataset ───────────────────────────────────────────
  const rows = {
    leads: [], selections: [], pricing: [], costLines: [],
    itineraryDays: [], dayPlaces: [], dayActivities: [], dayImages: [], dayTransports: [],
    optionalFlights: [], remarks: [], statusHistory: [], commLogs: [], internalEvents: [],
    customized: [], manual: [],
  };
  const plan = []; // per-lead facts the later steps need
  const aiFlags = []; // AI-intake columns Prisma cannot write (see below)

  const statuses = [];
  for (const [status, count] of Object.entries(MIX)) for (let i = 0; i < count; i += 1) statuses.push(status);

  for (let index = 0; index < statuses.length; index += 1) {
    const status = statuses[index];
    const leadId = ids.next('lead');
    const customer = customers.length ? rng.pick(customers) : null;
    const fromCountry = customerCountry(customer);
    const pkg = rng.pick(packages);
    const [source, platform] = rng.weighted(SOURCES.map(([s, , w]) => [[s, PLATFORM_FOR_SOURCE[s]], w]));

    const createdAt = addDays(now, -rng.int(2, 210));
    const travelDate = addDays(now, rng.int(21, 300));
    const durationDays = pkg.durationDays;
    const endDate = addDays(travelDate, durationDays - 1);
    const pax = rng.weighted([[1, 2], [2, 5], [3, 3], [4, 3], [5, 2], [6, 1]]);

    const assigned = status !== 'PENDING_VERIFICATION' && rng.chance(0.92) ? rng.pick(reps) : null;
    const assignmentMode = assigned && rng.chance(0.55) ? 'auto' : 'manual';

    const priority = rng.weighted([
      ['low', status === 'CLOSED_LOST' ? 4 : 2],
      ['medium', 5],
      ['high', status === 'CONFIRMED' || status === 'APPROVED' ? 6 : 2],
    ]);

    const budgetBase = money(Number(pkg.sellPrice ?? pkg.basePrice) * pax);
    const useManual = rng.chance(0.07);
    const secondSelection = !useManual && rng.chance(0.16);

    const lead = {
      id: leadId,
      name: customer?.name ?? null,
      email: customer?.email ?? null,
      phone: customer?.phone ?? null,
      whatsapp: customer?.phone ?? null,
      city: customerCity(customer),
      source,
      platform,
      intakeChannel: platform,
      intakeSessionId: `${source}-${index + 1}`,
      fromCountry,
      destinationCountry: destinationCountry(pkg.destination),
      destination: pkg.destination,
      travelDate,
      endDate,
      leadDateTime: createdAt,
      numberOfTravelers: pax,
      budget: `USD ${Math.round(budgetBase / 100) * 100}`,
      message: rng.pick(INQUIRY_MESSAGES),
      lifecycleStatus: status,
      priority,
      assignedToId: assigned?.id ?? null,
      assignedById: assigned ? rng.pick(admins).id : null,
      assignmentMode,
      followUpDate: ['NEW', 'DRAFTING', 'QUOTED', 'REVISION'].includes(status) ? addDays(now, rng.int(-6, 14)) : null,
      lostReason: status === 'CLOSED_LOST' ? rng.pick(LOST_REASONS) : null,
      tags: tagsFor({ status, source, pkg, rng }),
      notifNewLead: true, notifStatusChange: true, notifAssignment: true, notifFollowUp: rng.chance(0.7),
      createdAt,
      updatedAt: addDays(createdAt, rng.int(0, 12)),
    };

    // The AI-intake columns (aiHandled, needsRepFollowup, aiVerifiedAt,
    // phoneNormalized, whatsappNormalized) exist in Postgres — the
    // add_chatbot_lead_intake migration added them — but lead-service's
    // schema.prisma was never updated to declare them, so the generated client
    // rejects them as unknown arguments. Set them with one raw UPDATE after the
    // insert instead of leaving the assistant's intake screens empty.
    aiFlags.push({
      id: leadId,
      ai: ['chatbot', 'voice_agent'].includes(source) ? true : rng.chance(0.15),
      nrf: ['chatbot', 'voice_agent'].includes(source) ? rng.chance(0.5) : false,
      verified: ['chatbot', 'voice_agent', 'website'].includes(source) && rng.chance(0.4) ? createdAt : null,
      phone: customer?.phone ? customer.phone.replace(/[^\d+]/g, '') : null,
      whatsapp: customer?.phone ? customer.phone.replace(/[^\d+]/g, '') : null,
    });

    // ── Selection(s) ────────────────────────────────────────────────────────
    const selectionIds = [];
    const specs = useManual
      ? [{ manual: true }]
      : [{ pkg }, ...(secondSelection ? [{ pkg: alternatePackage(packages, pkg, rng) }] : [])];

    if (specs.length === 1 && !useManual) specs.push({ pkg: null, pristine: true, bare: true });

    let primarySelectionId = null;
    for (let si = 0; si < specs.length; si += 1) {
      const spec = specs[si];
      if (spec.bare) continue; // intentionally not materialised below
      const selId = ids.next('selection');
      const isManual = Boolean(spec.manual);
      const selPkg = spec.pkg ?? null;

      rows.selections.push({
        id: selId,
        leadId,
        packageId: selPkg?.id ?? null,
        isManual,
        packageName: selPkg?.title ?? 'Manual itinerary',
        sourcePackageId: HAS_ITINERARY.has(status) && selPkg ? selPkg.id : null,
        destinationOverride: rng.chance(0.1) ? `${selPkg?.destination ?? pkg.destination} (private guide)` : null,
        currentQuoteId: null, // quotations step back-fills
        quoteAcceptedAt: null,
        createdAt,
        updatedAt: lead.updatedAt,
      });
      selectionIds.push({ id: selId, pkg: selPkg, isManual, primary: si === 0 });
      if (si === 0) primarySelectionId = selId;
    }

    if (!primarySelectionId) {
      // Manual-slot lead: the single selection is the manual one.
      const selId = ids.next('selection');
      rows.selections.push({
        id: selId, leadId, packageId: null, isManual: true, packageName: 'Manual itinerary',
        sourcePackageId: null, destinationOverride: null, currentQuoteId: null, quoteAcceptedAt: null,
        createdAt, updatedAt: lead.updatedAt,
      });
      selectionIds.push({ id: selId, pkg: null, isManual: true, primary: true });
      primarySelectionId = selId;
    }
    lead.primarySelectionId = primarySelectionId;

    // ── Per-selection children ──────────────────────────────────────────────
    const wantDays = HAS_ITINERARY.has(status);
    for (const sel of selectionIds) {
      const dayCap = sel.primary ? durationDays : 3;

      if (wantDays && sel.pkg) {
        const blueprint = await packageItinerary(sel.pkg.id);
        const take = blueprint.slice(0, Math.max(3, Math.min(dayCap, blueprint.length)));
        const perPersonMult = pax;
        for (let di = 0; di < take.length; di += 1) {
          const bpDay = take[di];
          const dayId = ids.next('leadItineraryDay');
          const acc = bpDay.accommodation && typeof bpDay.accommodation === 'object' ? bpDay.accommodation : {};
          rows.itineraryDays.push({
            id: dayId,
            leadPackageSelectionId: sel.id,
            dayNumber: di + 1,
            title: bpDay.title,
            description: bpDay.description,
            breakfastCount: bpDay.breakfastCount,
            lunchCount: bpDay.lunchCount,
            dinnerCount: bpDay.dinnerCount,
            mealPriceOverride: null,
            accommodation: acc,
            flights: [],
            createdAt,
            updatedAt: lead.updatedAt,
          });

          if (di === 0) {
            rows.dayImages.push({ id: ids.next('leadDayImage'), leadItineraryDayId: dayId, url: `https://picsum.photos/seed/${sel.pkg.slug ?? sel.pkg.id}-lead/1200/800`, altText: bpDay.title ?? 'Itinerary day', orderIndex: 0 });
          }

          bpDay.places.forEach((pp, pi) => {
            rows.dayPlaces.push({ id: ids.next('leadDayPlace'), leadItineraryDayId: dayId, placeId: pp.placeId, customName: pp.customName ?? null, orderIndex: pi });
          });
          bpDay.activities.forEach((pa, ai) => {
            rows.dayActivities.push({
              id: ids.next('leadDayActivity'),
              leadItineraryDayId: dayId,
              activityId: pa.activityId,
              name: pa.activity?.name ?? null,
              description: pa.activity?.description ?? null,
              defaultCost: pa.activity?.defaultCost ?? 0,
              costOverride: pa.costOverride ?? null,
              orderIndex: ai,
            });
          });
          bpDay.transports.forEach((pt, ti) => {
            rows.dayTransports.push({
              id: ids.next('leadDayTransport'),
              leadItineraryDayId: dayId,
              routeType: pt.routeType,
              transportMode: pt.transportMode,
              pricingModel: pt.pricingModel,
              unitCost: pt.unitCost,
              distanceKm: pt.distanceKm,
              origin: pt.originPlace?.name ?? null,
              destination: pt.destinationPlace?.name ?? null,
            });
          });
        }

        // Optional transfer flights the rep has flagged but not yet ticketed.
        if (rng.chance(0.55)) {
          for (const flightType of rng.chance(0.6) ? ['TO_START', 'RETURN_HOME'] : ['TO_START']) {
            rows.optionalFlights.push({
              id: ids.next('optionalFlight'),
              leadPackageSelectionId: sel.id,
              flightType,
              origin: flightType === 'TO_START' ? fromCountry.split(' ')[0].slice(0, 40) : 'Colombo (CMB)',
              destination: flightType === 'TO_START' ? 'Colombo (CMB)' : fromCountry.split(' ')[0].slice(0, 40),
              date: flightType === 'TO_START' ? travelDate : endDate,
              cabinClass: rng.weighted([['economy', 6], ['premium_economy', 2], ['business', 1]]),
              departureTime: `${String(rng.int(0, 23)).padStart(2, '0')}:${rng.pick(['00', '15', '30', '45'])}`,
              airlinePreference: rng.pick(['SriLankan Airlines', 'Emirates', 'Qatar Airways', 'Turkish Airlines', 'Singapore Airlines']),
              notes: 'Quoted on request; fares subject to change until ticketed.',
              flightBookingId: null,
              status: rng.weighted([['PENDING', 6], ['QUOTED', 3], ['BOOKED', 1]]),
              estimatedUnitPrice: money(rng.int(420, 1450)),
              actualUnitPrice: null,
              quantity: pax,
              marginType: 'PERCENTAGE',
              marginValue: money(rng.int(8, 18)),
              createdAt,
              updatedAt: lead.updatedAt,
            });
          }
        }
      }

      // ── Pricing + cost lines ──────────────────────────────────────────────
      if (HAS_PRICING.has(status)) {
        const blueprint = sel.pkg ? await packageItinerary(sel.pkg.id) : [];
        const costed = costLinesFor({ blueprint, pkg: sel.pkg, pax, rng, fromCountry });
        const marginPct = Number(sel.pkg?.defaultMarginInput ?? 20);
        const marginType = sel.pkg?.defaultMarginType ?? 'PERCENTAGE';

        let costTotal = 0;
        for (const cl of costed) {
          const est = money(cl.estimatedUnitPrice * cl.quantity);
          const sell = marginType === 'PERCENTAGE' ? money(est * (1 + marginPct / 100)) : money(est + marginPct * cl.quantity);
          costTotal += est;
          rows.costLines.push({
            id: ids.next('costLine'),
            leadPackageSelectionId: sel.id,
            category: cl.category,
            description: cl.description,
            basis: cl.basis,
            quantity: cl.quantity,
            estimatedUnitPrice: cl.estimatedUnitPrice,
            actualUnitPrice: status === 'CONFIRMED' ? money(cl.estimatedUnitPrice * (0.97 + rng.next() * 0.08)) : null,
            quotedUnitPrice: cl.estimatedUnitPrice,
            estimatedTotal: est,
            actualTotal: status === 'CONFIRMED' ? money(est * 0.995) : null,
            sellTotal: sell,
            marginType,
            marginValue: marginPct,
            source: rng.chance(0.75) ? 'AUTO' : 'MANUAL',
            dayNumber: cl.dayNumber ?? null,
            flightBookingId: null,
            optionalFlightId: null,
            orderIndex: rows.costLines.length,
            createdAt,
            updatedAt: lead.updatedAt,
          });
        }

        const sellSubtotal = money(costed.reduce((s, cl) => s + cl.estimatedUnitPrice * cl.quantity, 0) * (marginType === 'PERCENTAGE' ? 1 + marginPct / 100 : 1) + (marginType === 'FIXED' ? marginPct * costed.length : 0));
        const discountType = rng.weighted([['none', 6], ['percentage', 3], ['fixed', 2]]);
        const discountValue = discountType === 'none' ? 0 : discountType === 'percentage' ? rng.int(2, 10) : money(rng.int(50, 400));
        const discountAmount = discountType === 'none' ? 0 : discountType === 'percentage' ? money(sellSubtotal * (discountValue / 100)) : discountValue;
        const taxableSubtotal = money(sellSubtotal - discountAmount);
        const taxRate = rng.chance(0.35) ? money(rng.int(3, 12)) : 0;
        const taxAmount = money(taxableSubtotal * (taxRate / 100));
        const serviceChargeRate = 5;
        const serviceChargeAmount = money(taxableSubtotal * (serviceChargeRate / 100));
        const totalAmount = money(taxableSubtotal + taxAmount + serviceChargeAmount);
        const depositType = rng.chance(0.7) ? 'PERCENTAGE' : 'FIXED';
        const depositValue = depositType === 'PERCENTAGE' ? 25 : money(rng.int(300, 900));
        const depositAmount = depositType === 'PERCENTAGE' ? money(totalAmount * (depositValue / 100)) : depositValue;
        const paidAmount = paidForStatus(status, totalAmount, depositAmount, rng);
        const profit = money(totalAmount - costTotal);

        rows.pricing.push({
          id: ids.next('pricing'),
          leadPackageSelectionId: sel.id,
          currency: 'USD',
          marginType,
          marginValue: marginPct,
          depositType,
          depositValue,
          discountType,
          discountValue,
          serviceChargeRate,
          estimatedTotal: money(costTotal),
          actualTotal: status === 'CONFIRMED' ? money(costTotal * 0.995) : null,
          sellSubtotal,
          discountAmount,
          taxableSubtotal,
          taxAmount,
          serviceChargeAmount,
          totalAmount,
          depositAmount,
          paidAmount,
          balanceDue: money(totalAmount - paidAmount),
          profit,
          createdAt,
          updatedAt: lead.updatedAt,
        });

        sel.costTotal = costTotal;
        sel.totalAmount = totalAmount;
        sel.depositAmount = depositAmount;
        sel.paidAmount = paidAmount;
        sel.currency = 'USD';
      }
    }

    // ── Status history, remarks, comms, internal events ─────────────────────
    const path = STATUS_PATH[status];
    const span = Math.max(1, (now - createdAt) / (path.length + 1));
    path.forEach((s, i) => {
      rows.statusHistory.push({
        id: ids.next('statusHistory'),
        leadId,
        status: s,
        actor: i === 0 && ['website', 'booking', 'chatbot', 'voice_agent'].includes(source) ? 'SYSTEM' : 'USER',
        changedById: i === 0 ? null : rng.pick(reps).id,
        changedAt: new Date(createdAt.getTime() + span * (i + 1)),
        notes: i === 0 ? 'Lead created from ' + platform.replace(/_/g, ' ') : null,
      });
    });

    const remarkCount = rng.int(0, 4);
    for (let i = 0; i < remarkCount; i += 1) {
      rows.remarks.push({
        id: ids.next('remark'),
        leadId,
        text: rng.pick(LEAD_REMARKS),
        addedById: assigned?.id ?? rng.pick(reps).id,
        date: addDays(createdAt, rng.int(0, 40)),
        addedAt: addDays(createdAt, rng.int(0, 40)),
      });
    }

    const commCount = rng.int(1, 4);
    for (let i = 0; i < commCount; i += 1) {
      rows.commLogs.push({
        id: ids.next('commLog'),
        leadId,
        date: addDays(createdAt, rng.int(0, 45)),
        type: rng.weighted([['call', 4], ['email', 5], ['whatsapp', 4], ['message', 2], ['meeting', 1]]),
        notes: rng.pick(COMMUNICATION_NOTES),
        externalMessageId: rng.chance(0.5) ? `${leadId.slice(0, 8)}-msg-${i}` : null,
        byId: assigned?.id ?? rng.pick(reps).id,
      });
    }

    if (['QUOTED', 'REVISION', 'APPROVED', 'CONFIRMED'].includes(status)) {
      rows.internalEvents.push({
        id: ids.next('internalEvent'),
        eventId: `evt-${leadId.slice(0, 8)}-quotation-sent`,
        leadId,
        type: 'quotation.sent',
        payload: { leadId, status, at: isoDay(lead.updatedAt) },
        processedAt: lead.updatedAt,
      });
    }

    // ── Website-form ports: a bespoke package or a manual itinerary ──────────
    if (useManual || rng.chance(0.06)) {
      rows.customized.push({
        id: ids.next('customizedPackage'),
        leadId,
        originalPackageId: pkg.id,
        name: `${pkg.title} — tailored for ${lead.name ?? 'the traveller'}`,
        description: `A private version of ${pkg.title}, adjusted to the traveller's dates, party size and pace.`,
        destination: pkg.destination,
        duration: durationDays + rng.int(-1, 3),
        price: money(Number(pkg.sellPrice ?? pkg.basePrice) * 1.12),
        maxGroupSize: Math.max(pax, rng.int(pax, 12)),
        category: pkg.category,
        images: [],
        coverImage: { url: `https://picsum.photos/seed/${pkg.slug ?? pkg.id}-custom/1200/800`, public_id: null },
        inclusions: ['Accommodation as per the tailor-made plan', 'Private guide throughout', 'All transfers and excursions listed'],
        exclusions: ['International flights', 'Travel insurance', 'Personal expenses'],
        highlights: ['Private departures on your dates', 'Flexible pace', 'Hand-picked stays'],
        terms: ['Deposit 25% to confirm', 'Balance due 21 days before travel'],
        days: [],
        status: status === 'CONFIRMED' ? 'confirmed' : status === 'CANCELLED' ? 'cancelled' : 'pending',
        customizationNotes: rng.pick(SPECIAL_REQUESTS),
        createdAt,
        updatedAt: lead.updatedAt,
      });
    }

    if (useManual) {
      const manualId = ids.next('manualItinerary');
      rows.manual.push({
        id: manualId,
        leadId,
        days: [
          { day: 1, title: 'Arrival and welcome', description: 'Met on arrival and transferred to your hotel.', meals: { breakfast: false, lunch: false, dinner: true }, accommodation: 'Your chosen hotel' },
          { day: 2, title: 'Private guided day', description: 'A full day with your own guide, arranged around what you want to see.', meals: { breakfast: true, lunch: true, dinner: false }, accommodation: 'Your chosen hotel' },
          { day: 3, title: 'At leisure and departure', description: 'A free morning before your transfer to the airport.', meals: { breakfast: true, lunch: false, dinner: false }, accommodation: null },
        ],
        status: status === 'CONFIRMED' ? 'confirmed' : status === 'CANCELLED' ? 'cancelled' : 'pending',
        version: 1,
        createdAt,
        updatedAt: lead.updatedAt,
      });
      lead.currentItineraryId = manualId;
    }

    rows.leads.push(lead);
    plan.push({
      id: leadId,
      name: lead.name,
      customerId: customer?.id ?? null,
      email: lead.email,
      phone: lead.phone,
      status,
      source,
      platform,
      destination: lead.destination,
      fromCountry,
      travelDate,
      endDate,
      pax,
      assignedToId: lead.assignedToId,
      createdAt,
      primarySelectionId,
      selections: selectionIds.map((s) => ({ id: s.id, packageId: s.pkg?.id ?? null, packageTitle: s.pkg?.title ?? 'Manual itinerary', isManual: s.isManual, primary: s.primary, costTotal: s.costTotal ?? null, totalAmount: s.totalAmount ?? null, depositAmount: s.depositAmount ?? null, paidAmount: s.paidAmount ?? null })),
    });
  }

  // ── Write, children before parents where Prisma requires it ───────────────
  await db.lead.lead.createMany({ data: rows.leads, skipDuplicates: true });

  await db.sql.query(
    `UPDATE crm_leads."Lead" l SET
        "aiHandled" = v.ai,
        "needsRepFollowup" = v.nrf,
        "aiVerifiedAt" = v.verified,
        "phoneNormalized" = v.phone,
        "whatsappNormalized" = v.whatsapp
       FROM (SELECT unnest($1::text[]) AS id, unnest($2::bool[]) AS ai, unnest($3::bool[]) AS nrf,
                    unnest($4::timestamp[]) AS verified, unnest($5::text[]) AS phone, unnest($6::text[]) AS whatsapp) v
      WHERE l.id = v.id`,
    [
      aiFlags.map((f) => f.id),
      aiFlags.map((f) => f.ai),
      aiFlags.map((f) => f.nrf),
      aiFlags.map((f) => f.verified),
      aiFlags.map((f) => f.phone),
      aiFlags.map((f) => f.whatsapp),
    ],
  );
  await db.lead.leadStatusHistory.createMany({ data: rows.statusHistory, skipDuplicates: true });
  await db.lead.leadRemark.createMany({ data: rows.remarks, skipDuplicates: true });
  await db.lead.leadCommunicationLog.createMany({ data: rows.commLogs, skipDuplicates: true });
  await db.lead.leadInternalEvent.createMany({ data: rows.internalEvents, skipDuplicates: true });
  await db.lead.customizedPackage.createMany({ data: rows.customized, skipDuplicates: true });
  await db.lead.manualItinerary.createMany({ data: rows.manual, skipDuplicates: true });
  await db.lead.leadPackageSelection.createMany({ data: rows.selections, skipDuplicates: true });
  await db.lead.leadPricing.createMany({ data: rows.pricing, skipDuplicates: true });
  await db.lead.leadCostLine.createMany({ data: rows.costLines, skipDuplicates: true });
  await db.lead.leadItineraryDay.createMany({ data: rows.itineraryDays, skipDuplicates: true });
  await db.lead.leadDayPlace.createMany({ data: rows.dayPlaces, skipDuplicates: true });
  await db.lead.leadDayActivity.createMany({ data: rows.dayActivities, skipDuplicates: true });
  await db.lead.leadDayImage.createMany({ data: rows.dayImages, skipDuplicates: true });
  await db.lead.leadDayTransport.createMany({ data: rows.dayTransports, skipDuplicates: true });
  await db.lead.leadOptionalFlight.createMany({ data: rows.optionalFlights, skipDuplicates: true });

  // ── Enrich pre-existing leads ─────────────────────────────────────────────
  // The older seeds left a handful of leads with a selection but no costing and
  // no copied itinerary, and they sit near the top of the default newest-first
  // list — so without this the first row a demo clicks opens an empty Pricing
  // section and "No itinerary specified". Only selections this run did not
  // create are considered, and the two gaps are checked SEPARATELY: a selection
  // can have one without the other, and adding the itinerary again just because
  // the pricing is still missing would duplicate the days on every run.
  const ownLeadIds = new Set(rows.leads.map((l) => l.id));
  const preExisting = await db.lead.leadPackageSelection.findMany({
    where: { leadId: { notIn: [...ownLeadIds] } },
    include: {
      lead: { select: { id: true, name: true, email: true, phone: true, numberOfTravelers: true, assignedToId: true, travelDate: true, createdAt: true, updatedAt: true, destination: true } },
      pricing: { select: { id: true } },
      _count: { select: { itineraryDays: true } },
    },
  });

  // The sequential counter restarts, for a given run, just after the main
  // pass's last id — which is precisely the range a PREVIOUS run's enrichment
  // rows already occupy. Minting from a disjoint high range instead makes these
  // ids stable across runs, so re-running neither collides nor duplicates.
  let enrichSeq = 0;
  const nextEnrichId = (category) => idFor(category, 900000 + (enrichSeq += 1));

  const extra = { pricing: [], costLines: [], days: [], dayPlaces: [], dayActivities: [], dayTransports: [] };
  for (const sel of preExisting) {
    const pkg = packages.find((x) => x.id === sel.packageId);
    if (!pkg) continue;
    const blueprint = await packageItinerary(pkg.id);
    if (!blueprint.length) continue;
    const lead = sel.lead;
    const pax = lead.numberOfTravelers ?? 2;
    const createdAt = lead.createdAt;
    const updatedAt = lead.updatedAt ?? createdAt;
    const needsDays = sel._count.itineraryDays === 0;
    const needsPricing = sel.pricing === null

    if (needsDays) {
      for (let di = 0; di < blueprint.length; di += 1) {
        const bpDay = blueprint[di];
        const dayId = nextEnrichId('leadItineraryDay');
        const acc = bpDay.accommodation && typeof bpDay.accommodation === 'object' ? bpDay.accommodation : {};
        extra.days.push({
          id: dayId, leadPackageSelectionId: sel.id, dayNumber: di + 1, title: bpDay.title, description: bpDay.description,
          breakfastCount: bpDay.breakfastCount, lunchCount: bpDay.lunchCount, dinnerCount: bpDay.dinnerCount,
          mealPriceOverride: null, accommodation: acc, flights: [], createdAt, updatedAt,
        });
        bpDay.places.forEach((pp, pi) => extra.dayPlaces.push({ id: nextEnrichId('leadDayPlace'), leadItineraryDayId: dayId, placeId: pp.placeId, customName: pp.customName ?? null, orderIndex: pi }));
        bpDay.activities.forEach((pa, ai) => extra.dayActivities.push({
          id: nextEnrichId('leadDayActivity'), leadItineraryDayId: dayId, activityId: pa.activityId,
          name: pa.activity?.name ?? null, description: pa.activity?.description ?? null,
          defaultCost: pa.activity?.defaultCost ?? 0, costOverride: pa.costOverride ?? null, orderIndex: ai,
        }));
        bpDay.transports.forEach((pt) => extra.dayTransports.push({
          id: nextEnrichId('leadDayTransport'), leadItineraryDayId: dayId, routeType: pt.routeType,
          transportMode: pt.transportMode, pricingModel: pt.pricingModel, unitCost: pt.unitCost,
          distanceKm: pt.distanceKm, origin: pt.originPlace?.name ?? null, destination: pt.destinationPlace?.name ?? null,
        }));
      }
    }

    if (needsPricing) {
      const costed = costLinesFor({ blueprint, pkg, pax, rng, fromCountry: 'Sri Lanka' });
      const marginPct = Number(pkg.defaultMarginInput ?? 20);
      let costTotal = 0;
      for (const cl of costed) {
        const est = money(cl.estimatedUnitPrice * cl.quantity);
        costTotal += est;
        extra.costLines.push({
          id: nextEnrichId('costLine'), leadPackageSelectionId: sel.id, category: cl.category, description: cl.description,
          basis: cl.basis, quantity: cl.quantity, estimatedUnitPrice: cl.estimatedUnitPrice, actualUnitPrice: null,
          quotedUnitPrice: cl.estimatedUnitPrice, estimatedTotal: est, actualTotal: null,
          sellTotal: money(est * (1 + marginPct / 100)), marginType: pkg.defaultMarginType ?? 'PERCENTAGE',
          marginValue: marginPct, source: 'AUTO', dayNumber: null, flightBookingId: null, optionalFlightId: null,
          orderIndex: extra.costLines.length, createdAt, updatedAt,
        });
      }
      const sellSubtotal = money(costTotal * (1 + marginPct / 100));
      const serviceChargeAmount = money(sellSubtotal * 0.05);
      const totalAmount = money(sellSubtotal + serviceChargeAmount);
      extra.pricing.push({
        id: nextEnrichId('pricing'), leadPackageSelectionId: sel.id, currency: 'USD',
        marginType: pkg.defaultMarginType ?? 'PERCENTAGE', marginValue: marginPct,
        depositType: 'PERCENTAGE', depositValue: 25, discountType: 'none', discountValue: 0, serviceChargeRate: 5,
        estimatedTotal: money(costTotal), actualTotal: null, sellSubtotal, discountAmount: 0,
        taxableSubtotal: sellSubtotal, taxAmount: 0, serviceChargeAmount, totalAmount,
        depositAmount: money(totalAmount * 0.25), paidAmount: 0, balanceDue: totalAmount,
        profit: money(totalAmount - costTotal), createdAt, updatedAt,
      });
    }
  }

  // Deliberately NOT skipDuplicates: every row here is one the checks above
  // proved was missing, so a conflict is a real bug — and swallowing it is what
  // produced a lead with an itinerary and no costing, the exact half-populated
  // state this pass exists to remove.
  if (extra.days.length) {
    await db.lead.leadItineraryDay.createMany({ data: extra.days });
    await db.lead.leadDayPlace.createMany({ data: extra.dayPlaces });
    await db.lead.leadDayActivity.createMany({ data: extra.dayActivities });
    await db.lead.leadDayTransport.createMany({ data: extra.dayTransports });
  }
  if (extra.pricing.length) {
    await db.lead.leadPricing.createMany({ data: extra.pricing });
    await db.lead.leadCostLine.createMany({ data: extra.costLines });
  }

  // ── Assignment settings singleton ────────────────────────────────────────
  const settings = {
    assignmentMode: 'auto',
    autoStrategy: 'round_robin',
    enabledSalesRepIds: reps.map((r) => r.id),
    roundRobinIndex: rng.int(0, reps.length - 1),
    maxOpenLeadsPerRep: 60,
    skipInactive: true,
    requireActiveLogin48h: false,
    updatedById: admins[0]?.id ?? null,
  };
  await db.lead.settings.upsert({
    where: { tenantId_singletonKey: { tenantId: requireTenantId(), singletonKey: 1 } },
    update: settings,
    create: { id: ids.next('leadSettings'), ...settings },
  });

  const counts = Object.fromEntries(Object.entries(MIX));
  log(`    leads: ${rows.leads.length} (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);

  return {
    summary: `${plan.length} leads · ${rows.selections.length} selections · ${rows.costLines.length} cost lines`,
    plan,
    settings,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function paidForStatus(status, total, deposit, rng) {
  if (status === 'CONFIRMED') return rng.weighted([[total, 5], [deposit, 3], [money(total * 0.5), 2]]);
  if (status === 'BOOKING_IN_PROGRESS') return rng.chance(0.6) ? deposit : 0;
  if (['CANCELLED', 'BOOKING_FAILED'].includes(status)) return rng.chance(0.4) ? deposit : 0;
  return 0;
}

/**
 * Cost lines for one selection, derived from the package itinerary that was
 * actually cloned onto the lead — so the lead's costing and its itinerary
 * describe the same trip.
 */
function costLinesFor({ blueprint, pkg, pax, rng, fromCountry }) {
  const lines = [];
  const nights = Math.max(1, blueprint.length - 1);

  const roomTotal = blueprint.reduce((s, d) => {
    const acc = d.accommodation && typeof d.accommodation === 'object' ? d.accommodation : {};
    return s + Number(acc.totalAmount ?? 0);
  }, 0);
  if (roomTotal > 0) {
    lines.push({ category: 'accommodation', description: `${nights} nights — hotels as per itinerary`, basis: 'PER_ROOM', quantity: Math.max(1, Math.ceil(pax / 2)), estimatedUnitPrice: money(roomTotal / Math.max(1, Math.ceil(pax / 2))) });
  }

  const transportTotal = blueprint.reduce((s, d) => s + d.transports.reduce((t, x) => t + Number(x.unitCost ?? 0), 0), 0);
  if (transportTotal > 0) {
    lines.push({ category: 'transportation', description: 'Private vehicle, driver and all road transfers', basis: 'PER_VEHICLE', quantity: 1, estimatedUnitPrice: money(transportTotal) });
  }

  const activityTotal = blueprint.reduce((s, d) => s + d.activities.reduce((t, a) => t + Number(a.costOverride ?? a.activity?.defaultCost ?? 0), 0), 0);
  if (activityTotal > 0) {
    lines.push({ category: 'activity', description: 'Entrance fees and excursions as listed in the itinerary', basis: 'PER_PERSON', quantity: pax, estimatedUnitPrice: money(activityTotal) });
  }

  const mealTotal = blueprint.reduce((s, d) => {
    const acc = d.accommodation && typeof d.accommodation === 'object' ? d.accommodation : {};
    return s + Number(acc.mealAmount ?? 0);
  }, 0);
  if (mealTotal > 0) {
    lines.push({ category: 'food', description: 'Meals as listed in the itinerary', basis: 'PER_PERSON', quantity: pax, estimatedUnitPrice: money(mealTotal) });
  }

  lines.push({ category: 'guide', description: 'English-speaking chauffeur guide throughout', basis: 'FIXED', quantity: Math.max(1, blueprint.length), estimatedUnitPrice: money(rng.int(35, 70)) });
  lines.push({ category: 'insurance', description: 'Travel insurance — medical, cancellation and curtailment', basis: 'PER_PERSON', quantity: pax, estimatedUnitPrice: money(rng.int(28, 65)) });

  if (['Nepal', 'Bhutan', 'India', 'Vietnam', 'Kenya', 'Egypt', 'Turkey', 'Japan'].includes(pkg?.destination ?? '') || rng.chance(0.5)) {
    lines.push({ category: 'visa', description: 'Visa, ETA and entry permit fees', basis: 'PER_PERSON', quantity: pax, estimatedUnitPrice: money(rng.int(20, 120)) });
  }

  return lines;
}

function alternatePackage(packages, exclude, rng) {
  const others = packages.filter((p) => p.id !== exclude.id && p.destination !== exclude.destination);
  return others.length ? rng.pick(others) : rng.pick(packages);
}

function tagsFor({ status, source, pkg, rng }) {
  const tags = ['seed', 'demo'];
  if (pkg.category === 'HONEYMOON') tags.push('honeymoon');
  if (pkg.category === 'WILD_SAFARI') tags.push('safari');
  if (pkg.isFeatured) tags.push('featured-package');
  if (['chatbot', 'voice_agent'].includes(source)) tags.push('ai-intake');
  if (status === 'CONFIRMED') tags.push('repeat-potential');
  if (rng.chance(0.2)) tags.push('vip');
  return tags;
}

function customerCountry(customer) {
  if (!customer?.phone) return 'Sri Lanka';
  const m = /^\+(\d{1,3})/.exec(customer.phone);
  const map = { 94: 'Sri Lanka', 44: 'United Kingdom', 49: 'Germany', 33: 'France', 31: 'Netherlands', 39: 'Italy', 34: 'Spain', 46: 'Sweden', 47: 'Norway', 353: 'Ireland', 91: 'India', 971: 'United Arab Emirates', 966: 'Saudi Arabia', 86: 'China', 81: 'Japan', 82: 'South Korea', 61: 'Australia', 64: 'New Zealand', 1: 'United States', 254: 'Kenya', 41: 'Switzerland', 65: 'Singapore', 60: 'Malaysia' };
  return map[m?.[1]] ?? 'United States';
}

function customerCity(customer) {
  if (!customer) return null;
  const known = { 'david.kumar@gmail.com': 'Colombo', 'emily.chen@gmail.com': 'Singapore' };
  return known[customer.email] ?? null;
}

function destinationCountry(destination) {
  const map = {
    'Sri Lanka': 'Sri Lanka', Maldives: 'Maldives', Thailand: 'Thailand', 'Bali, Indonesia': 'Indonesia',
    'Dubai, UAE': 'United Arab Emirates', Japan: 'Japan', Singapore: 'Singapore', Vietnam: 'Vietnam',
    Nepal: 'Nepal', Turkey: 'T\u00fcrkiye', Egypt: 'Egypt', Morocco: 'Morocco', Kenya: 'Kenya', Bhutan: 'Bhutan',
    'Europe (UK, France, Netherlands, Italy)': 'Europe',
  };
  return map[destination] ?? destination;
}
