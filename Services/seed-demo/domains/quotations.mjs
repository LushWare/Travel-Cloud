/**
 * crm_billing — quotations.
 *
 * A quotation is the priced document the rep sends, built from the cost lines
 * already sitting on the lead's selection. That is deliberate: the quotation's
 * line items, subtotal and total are derived from the lead's own pricing, so
 * the two screens can never disagree about what was quoted.
 *
 * Runs after leads and before bookings/invoices, and back-fills the
 * selection's `currentQuoteId` so the lead editor, the quotation modal and the
 * voucher builder all follow the same pointer.
 */
import { addDays, humanDay, isoDay, money } from '../lib/rng.mjs';
import { CATEGORIES, ownedPrefix } from '../lib/ids.mjs';
import { AGENCY } from '../lib/fixtures.mjs';

/** Leads that got as far as a priced document. */
const QUOTED_STATUSES = new Set(['QUOTED', 'REVISION', 'APPROVED', 'BOOKING_IN_PROGRESS', 'CONFIRMED', 'CLOSED_LOST', 'BOOKING_FAILED']);

const STATUS_FOR_LEAD = {
  QUOTED: ['sent', 'viewed'],
  REVISION: ['sent', 'viewed'],
  APPROVED: ['accepted'],
  BOOKING_IN_PROGRESS: ['accepted'],
  CONFIRMED: ['converted'],
  CLOSED_LOST: ['rejected', 'expired'],
  BOOKING_FAILED: ['accepted'],
};

export async function seed(ctx) {
  const { db, ids, now, log } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('quotations');
  const { plan } = ctx.data.leads;
  const { reps } = ctx.data.users;
  const { list: packages } = ctx.data.packages;

  const packageById = new Map(packages.map((p) => [p.id, p]));
  // LeadDayPlace.placeId is a cross-schema snapshot ref with no Prisma relation
  // (the packages schema is another service's), so names are resolved through
  // the dictionary this run already holds rather than through an include.
  const placeNameById = new Map([...ctx.data.packages.places.values()].map((pl) => [pl.id, pl.name]));
  const eligible = plan.filter((l) => QUOTED_STATUSES.has(l.status) && l.selections.some((s) => !s.isManual && s.packageId));

  // Numbering: PREFIX-YYYYMM-NNNNN, matching the shape billing-service itself
  // generates so the two are indistinguishable.
  /**
   * Document numbers are derived from the row's own deterministic id, not from a
   * running per-month counter. A counter makes the number depend on loop order
   * and on dates drawn from the shared rng stream — both of which shift whenever
   * an earlier step gains or loses a draw — so a later run could mint a number
   * that already belonged to a different row. The unique index would then reject
   * the insert, `skipDuplicates` would drop the parent silently, and every child
   * pointing at it would fail its foreign key.
   */
  const docNumber = (prefix, date, id) =>
    `${prefix}-${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(id).slice(-5)}`;

  // Own the id prefix (children first): a re-run rewrites the same documents
  // instead of appending a second set whose numbers and ids have drifted.
  for (const sql of [
    `DELETE FROM crm_billing."QuotationItem" WHERE id LIKE $1`,
    `DELETE FROM crm_billing."QuotationImage" WHERE id LIKE $1`,
    `DELETE FROM crm_billing."QuotationRevision" WHERE id LIKE $1`,
    `DELETE FROM crm_billing."Quotation" WHERE id LIKE $1`,
  ]) {
    await db.sql.query(sql, [`${ownedPrefix('quotation')}%`]);
  }

  const quotations = [];
  const items = [];
  const revisions = [];
  const images = [];
  const backfill = [];

  for (const lead of eligible) {
    const selection = lead.selections.find((s) => !s.isManual && s.packageId) ?? lead.selections[0];
    const pkg = packageById.get(selection.packageId) ?? null;
    const quoteId = ids.next('quotation');

    const issueDate = addDays(now, -rng.int(3, 90));
    const validUntil = addDays(issueDate, AGENCY.quotationValidityDays);
    const status = rng.pick(STATUS_FOR_LEAD[lead.status] ?? ['sent']);
    const version = lead.status === 'REVISION' ? 2 : 1;

    // Line items come from the costing the lead step already wrote.
    const costLines = await db.lead.leadCostLine.findMany({
      where: { leadPackageSelectionId: selection.id },
      orderBy: { orderIndex: 'asc' },
    });

    const lineItems = costLines.map((cl, i) => {
      const unit = Number(cl.sellTotal) / Math.max(1, cl.quantity);
      return {
        id: ids.next('quotationItem'),
        quotationId: quoteId,
        description: cl.description,
        category: cl.category,
        quantity: cl.quantity,
        unitPrice: money(unit),
        totalPrice: money(Number(cl.sellTotal)),
        taxRate: 0,
        notes: null,
        order: i,
      };
    });

    const subtotal = money(lineItems.reduce((s, li) => s + li.totalPrice, 0));
    const customerName = lead.name ?? 'Website Enquiry';
    const customerEmail = lead.email ?? 'enquiries@lushtravelcloud.com';

    const pricing = await db.lead.leadPricing.findUnique({ where: { leadPackageSelectionId: selection.id } });
    const discountType = pricing ? MapDiscount(pricing.discountType) : 'none';
    const discountAmount = pricing ? Number(pricing.discountAmount) : 0;
    const taxRate = pricing ? Number(pricing.taxRate ?? 0) : 0;
    const taxAmount = pricing ? Number(pricing.taxAmount) : 0;
    const serviceChargeRate = pricing ? Number(pricing.serviceChargeRate) : 0;
    const serviceChargeAmount = pricing ? Number(pricing.serviceChargeAmount) : 0;
    const totalAmount = pricing ? Number(pricing.totalAmount) : subtotal;

    const advisor = reps.find((r) => r.id === lead.assignedToId) ?? rng.pick(reps);
    const durationDays = pkg?.durationDays ?? 5;

    const quotation = {
      id: quoteId,
      quotationNumber: docNumber('QUO', issueDate, quoteId),
      currency: 'USD',
      leadId: lead.id,
      packageId: pkg?.id ?? null,
      itineraryId: null,
      createdById: advisor.id,
      lastModifiedById: version > 1 ? advisor.id : null,
      convertedToInvoiceId: null, // invoices step back-fills for 'converted'
      customerName,
      customerEmail,
      customerPhone: lead.phone ?? null,
      customerAddress: customerAddress(lead, rng),
      customerGstNumber: null,
      type: pkg ? 'package_based' : 'custom',
      mode: 'detailed',
      subtotal,
      taxRate,
      taxAmount,
      discountType,
      discountValue: pricing ? Number(pricing.discountValue) : 0,
      discountAmount,
      serviceChargeRate,
      serviceChargeAmount,
      totalAmount,
      status,
      issueDate,
      validUntil,
      notes: `Prepared for ${customerName}. Prices are per party of ${lead.pax} and are subject to availability at the time of confirmation.`,
      terms: AGENCY.quotationTerms,
      paymentTerms: AGENCY.invoicePaymentTerms,
      includedServices: pkg ? ['Accommodation as listed', 'Private transport with driver-guide', 'All excursions in the itinerary', 'Airport transfers'] : ['Arranged privately as agreed'],
      excludedServices: ['International flights unless stated', 'Travel insurance', 'Visa fees', 'Personal expenses and gratuities'],
      destination: pkg?.destination ?? lead.destination,
      packageTitle: pkg?.title ?? selection.packageTitle,
      travelStartDate: lead.travelDate,
      travelEndDate: lead.endDate,
      paxCount: lead.pax,
      durationNights: Math.max(0, durationDays - 1),
      durationDays,
      highlights: pkg ? buildHighlights(pkg, rng) : [],
      itineraryDays: await buildItinerarySnapshot(db, selection.id, placeNameById),
      advisorName: advisor.name,
      advisorPhone: '+94 11 745 2200',
      advisorEmail: advisor.email,
      coverImage: pkg ? `https://picsum.photos/seed/${pkg.slug ?? pkg.id}-quote/1200/800` : null,
      pdfUrl: `https://documents.lushtravelcloud.com/quotations/${quoteId}.pdf`,
      sentAt: status === 'draft' ? null : addDays(issueDate, rng.int(0, 2)),
      emailSent: status !== 'draft',
      whatsappSent: status !== 'draft' && rng.chance(0.5),
      whatsappSentAt: status !== 'draft' && rng.chance(0.5) ? addDays(issueDate, 1) : null,
      viewedAt: ['viewed', 'accepted', 'rejected', 'expired', 'converted'].includes(status) ? addDays(issueDate, rng.int(1, 6)) : null,
      acceptedAt: ['accepted', 'converted'].includes(status) ? addDays(issueDate, rng.int(2, 12)) : null,
      rejectedAt: status === 'rejected' ? addDays(issueDate, rng.int(2, 20)) : null,
      rejectionReason: status === 'rejected' ? 'Traveller chose an alternative operator on price.' : null,
      expiresAt: status === 'expired' ? validUntil : null,
      version,
      createdAt: issueDate,
      updatedAt: addDays(issueDate, rng.int(0, 5)),
    };

    quotations.push(quotation);
    items.push(...lineItems);

    // Revision history: one row per version, the first always present.
    for (let v = 1; v <= version; v += 1) {
      revisions.push({
        id: ids.next('quotationRevision'),
        quotationId: quoteId,
        version: v,
        modifiedById: v === 1 ? advisor.id : advisor.id,
        modifiedAt: addDays(issueDate, v === 1 ? 0 : rng.int(1, 4)),
        changes: v === 1 ? 'Initial quotation issued.' : 'Dates moved and one hotel upgraded; totals revised accordingly.',
      });
    }

    if (rng.chance(0.6)) {
      images.push({
        id: ids.next('quotationImage'),
        quotationId: quoteId,
        url: `https://picsum.photos/seed/${pkg?.slug ?? quoteId}-cover/1200/800`,
        isCover: true,
      });
    }

    backfill.push({
      selectionId: selection.id,
      quoteId,
      acceptedAt: ['accepted', 'converted'].includes(status) ? quotation.acceptedAt : null,
      status,
      totalAmount,
      quotationNumber: quotation.quotationNumber,
    });
  }

  // Quotation children first, then the parents (items/images/revisions carry a
  // required FK to Quotation).
  await db.bill.quotation.createMany({ data: quotations, skipDuplicates: true });
  await db.bill.quotationItem.createMany({ data: items, skipDuplicates: true });
  await db.bill.quotationRevision.createMany({ data: revisions, skipDuplicates: true });
  if (images.length) await db.bill.quotationImage.createMany({ data: images, skipDuplicates: true });

  for (const b of backfill) {
    await db.lead.leadPackageSelection.update({
      where: { id: b.selectionId },
      data: { currentQuoteId: b.quoteId, quoteAcceptedAt: b.acceptedAt },
    });
  }

  log(`    quotations: ${quotations.length} (${items.length} line items, ${revisions.length} revisions)`);

  return {
    summary: `${quotations.length} quotations · ${items.length} items`,
    list: quotations.map((q, i) => ({
      id: q.id,
      quotationNumber: q.quotationNumber,
      leadId: q.leadId,
      selectionId: backfill[i].selectionId,
      status: q.status,
      totalAmount: q.totalAmount,
      currency: q.currency,
      issueDate: q.issueDate,
      validUntil: q.validUntil,
      packageId: q.packageId,
      customerName: q.customerName,
      customerEmail: q.customerEmail,
      advisorId: q.createdById,
      accepted: ['accepted', 'converted'].includes(q.status),
    })),
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

const MapDiscount = (v) => (v === 'percentage' || v === 'fixed' ? v : 'none');

function customerAddress(lead, rng) {
  const street = rng.int(1, 200);
  return `${street} ${rng.pick(['High Street', 'Church Road', 'Station Lane', 'Park Avenue', 'Marine Drive'])}, ${lead.fromCountry ?? 'Sri Lanka'}`;
}

function buildHighlights(pkg, rng) {
  const pool = [
    `${pkg.durationDays} days in ${pkg.destination}`,
    'Hand-picked hotels, all personally inspected',
    'Private guide throughout — no shared coach touring',
    'Flexible daily pace built around your party',
    '24-hour local support number while you travel',
    'All internal transfers and listed excursions included',
  ];
  return rng.sample(pool, 4);
}

async function buildItinerarySnapshot(db, selectionId, placeNameById) {
  const days = await db.lead.leadItineraryDay.findMany({
    where: { leadPackageSelectionId: selectionId },
    orderBy: { dayNumber: 'asc' },
    include: { places: { orderBy: { orderIndex: 'asc' } }, activities: { orderBy: { orderIndex: 'asc' } } },
  });
  if (!days.length) return null;
  return days.map((d) => ({
    day: d.dayNumber,
    title: d.title,
    locations: d.places.map((p) => placeNameById.get(p.placeId) ?? p.customName).filter(Boolean),
    meals: [d.breakfastCount ? 'Breakfast' : null, d.lunchCount ? 'Lunch' : null, d.dinnerCount ? 'Dinner' : null].filter(Boolean),
    activities: d.activities.map((a) => a.name).filter(Boolean),
  }));
}
