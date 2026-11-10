/**
 * crm_billing — invoices, payments, credit notes and vouchers.
 *
 * Runs last of the billing steps for one reason: it is the only step that sees
 * both the quotation (raised earlier) and the booking (also earlier), so it is
 * the natural place to close the loops those two left open — Invoice.bookingId
 * → Booking.invoiceId and Quotation.convertedToInvoiceId.
 *
 * Money is taken from the lead's own costing wherever it exists, so the lead
 * summary, the quotation and the invoice all quote the same figure.
 */
import { addDays, isoDay, money } from '../lib/rng.mjs';
import { CATEGORIES, ownedPrefix } from '../lib/ids.mjs';
import { AGENCY } from '../lib/fixtures.mjs';

/** Leads that were billed. A lost lead never gets an invoice. */
const BILLED_STATUSES = new Set(['APPROVED', 'BOOKING_IN_PROGRESS', 'CONFIRMED', 'CANCELLED', 'BOOKING_FAILED']);

const INVOICE_STATUS_FOR_LEAD = {
  APPROVED: ['draft', 'sent'],
  BOOKING_IN_PROGRESS: ['sent', 'partial'],
  CONFIRMED: ['paid', 'partial'],
  CANCELLED: ['cancelled'],
  BOOKING_FAILED: ['overdue', 'sent'],
};

export async function seed(ctx) {
  const { db, ids, now, log } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('invoices');
  const { plan } = ctx.data.leads;
  const { reps } = ctx.data.users;
  const { list: packages } = ctx.data.packages;
  const bookingByLead = new Map((ctx.data.bookings?.list ?? []).map((b) => [b.leadId, b]));
  const quotationByLead = new Map((ctx.data.quotations?.list ?? []).map((q) => [q.leadId, q]));
  const packageById = new Map(packages.map((p) => [p.id, p]));
  // Cross-schema snapshot refs, resolved through the dictionary map rather than
  // a Prisma relation (there is none — packages is a different service).
  const placeNameById = new Map([...ctx.data.packages.places.values()].map((pl) => [pl.id, pl.name]));

  const eligible = plan.filter((l) => BILLED_STATUSES.has(l.status));

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

  // Own every id prefix this step writes, children before parents, so a re-run
  // produces the same invoices/receipts/vouchers rather than a second set. The
  // parents carry unique document numbers, and a drifted number would make
  // `skipDuplicates` drop the parent while its children still referenced it.
  const OWNED = [
    ['paymentHistory', `DELETE FROM crm_billing."PaymentHistory" WHERE id LIKE $1`],
    ['receipt', `DELETE FROM crm_billing."PaymentReceipt" WHERE id LIKE $1`],
    ['creditNoteItem', `DELETE FROM crm_billing."CreditNoteItem" WHERE id LIKE $1`],
    ['creditNote', `DELETE FROM crm_billing."CreditNote" WHERE id LIKE $1`],
    ['invoiceItem', `DELETE FROM crm_billing."InvoiceItem" WHERE id LIKE $1`],
    ['invoice', `DELETE FROM crm_billing."Invoice" WHERE id LIKE $1`],
    ['voucherFlightSegment', `DELETE FROM crm_billing."VoucherFlightSegment" WHERE id LIKE $1`],
    ['voucherMealPlan', `DELETE FROM crm_billing."VoucherMealPlan" WHERE id LIKE $1`],
    ['voucherLocationDate', `DELETE FROM crm_billing."VoucherLocationDate" WHERE id LIKE $1`],
    ['voucherItinerarySummary', `DELETE FROM crm_billing."VoucherItinerarySummary" WHERE id LIKE $1`],
    ['voucher', `DELETE FROM crm_billing."Voucher" WHERE id LIKE $1`],
  ];
  for (const [category, sql] of OWNED) {
    await db.sql.query(sql, [`${ownedPrefix(category)}%`]);
  }

  const invoices = [];
  const invoiceItems = [];
  const receipts = [];
  const paymentHistory = [];
  const creditNotes = [];
  const creditNoteItems = [];
  const vouchers = [];
  const voucherLocations = [];
  const voucherMeals = [];
  const voucherSummaries = [];
  const voucherFlights = [];
  const bookingBackfill = [];
  const quotationBackfill = [];

  for (const lead of eligible) {
    const selection = lead.selections.find((s) => !s.isManual && s.packageId) ?? lead.selections[0];
    const pkg = packageById.get(selection.packageId) ?? null;
    const booking = bookingByLead.get(lead.id) ?? null;

    const invoiceId = ids.next('invoice');
    const issueDate = addDays(now, -rng.int(5, 120));
    const dueDate = addDays(issueDate, 21);
    const status = rng.pick(INVOICE_STATUS_FOR_LEAD[lead.status] ?? ['sent']);
    const customerName = lead.name ?? 'Website Enquiry';
    const customerEmail = lead.email ?? 'accounts@lushtravelcloud.com';
    const assignedToId = lead.assignedToId ?? rng.pick(reps).id;

    // Line items mirror the lead's cost lines, priced at sell.
    const costLines = await db.lead.leadCostLine.findMany({
      where: { leadPackageSelectionId: selection.id },
      orderBy: { orderIndex: 'asc' },
    });
    const priced = costLines.length
      ? costLines.map((cl) => ({ description: cl.description, category: cl.category, quantity: cl.quantity, totalPrice: money(Number(cl.sellTotal)) }))
      : [{ description: `${pkg?.title ?? 'Travel arrangements'} — package price`, category: 'package', quantity: lead.pax, totalPrice: money(selection.totalAmount ?? 2400) }];

    const subtotal = money(priced.reduce((s, p) => s + p.totalPrice, 0));
    const totalAmount = money(selection.totalAmount ?? subtotal);
    const discountAmount = money(Math.max(0, subtotal - totalAmount));
    const paidAmount = status === 'paid'
      ? totalAmount
      : status === 'partial' || status === 'overdue' || status === 'sent' || status === 'viewed'
        ? paidFor({ status, total: totalAmount, booking, rng })
        : status === 'cancelled'
          ? paidFor({ status, total: totalAmount, booking, rng })
          : 0;

    const paymentStatus = paidAmount >= totalAmount ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

    for (let i = 0; i < priced.length; i += 1) {
      invoiceItems.push({
        id: ids.next('invoiceItem'),
        invoiceId,
        description: priced[i].description,
        category: priced[i].category,
        quantity: priced[i].quantity,
        unitPrice: money(priced[i].totalPrice / Math.max(1, priced[i].quantity)),
        totalPrice: priced[i].totalPrice,
        taxRate: 0,
        notes: null,
        order: i,
      });
    }

    const invoice = {
      id: invoiceId,
      invoiceNumber: docNumber('INV', issueDate, invoiceId),
      currency: 'USD',
      leadId: lead.id,
      quotationId: quotationByLead.get(lead.id)?.id ?? null,
      bookingId: booking?.id ?? null,
      createdById: assignedToId,
      lastModifiedById: null,
      cancelledById: status === 'cancelled' ? assignedToId : null,
      customerName,
      customerEmail,
      customerPhone: lead.phone ?? null,
      customerAddress: `${rng.int(1, 200)} ${rng.pick(['High Street', 'Church Road', 'Station Lane', 'Park Avenue'])}, ${lead.fromCountry ?? 'Sri Lanka'}`,
      customerGstNumber: null,
      destination: pkg?.destination ?? lead.destination,
      type: rng.weighted([['invoice', 8], ['proforma', 1], ['tax_invoice', 1]]),
      subtotal,
      taxRate: 0,
      taxAmount: 0,
      discountType: discountAmount > 0 ? 'fixed' : 'none',
      discountValue: discountAmount,
      discountAmount,
      serviceChargeRate: 0,
      serviceChargeAmount: 0,
      totalAmount,
      paidAmount,
      outstandingAmount: money(totalAmount - paidAmount),
      status,
      paymentStatus,
      dueDate,
      issueDate,
      paidDate: paymentStatus === 'paid' ? addDays(issueDate, rng.int(1, 20)) : null,
      notes: `Booking reference ${booking?.id?.slice(0, 8) ?? lead.id.slice(0, 8)}. Thank you for travelling with ${AGENCY.companyName}.`,
      terms: AGENCY.quotationTerms,
      paymentTerms: AGENCY.invoicePaymentTerms,
      paymentInstructions: AGENCY.invoicePaymentInstructions,
      bankAccountName: AGENCY.bankAccountName,
      bankAccountNumber: AGENCY.bankAccountNumber,
      bankName: AGENCY.bankName,
      bankIfscCode: AGENCY.bankIfscCode,
      bankSwiftCode: AGENCY.bankSwiftCode,
      bankBranch: AGENCY.bankBranch,
      bankUpiId: AGENCY.upiId,
      pdfUrl: `https://documents.lushtravelcloud.com/invoices/${invoiceId}.pdf`,
      sentAt: status === 'draft' ? null : addDays(issueDate, rng.int(0, 2)),
      emailSent: status !== 'draft',
      whatsappSent: status !== 'draft' && rng.chance(0.4),
      whatsappSentAt: status !== 'draft' && rng.chance(0.4) ? addDays(issueDate, 1) : null,
      viewedAt: ['viewed', 'paid', 'partial', 'overdue'].includes(status) ? addDays(issueDate, rng.int(1, 5)) : null,
      remindersSent: ['overdue', 'sent', 'partial'].includes(status) ? rng.int(1, 3) : 0,
      lastReminderSent: ['overdue', 'sent', 'partial'].includes(status) ? addDays(now, -rng.int(1, 10)) : null,
      cancelledAt: status === 'cancelled' ? addDays(issueDate, rng.int(3, 30)) : null,
      cancellationReason: status === 'cancelled' ? 'Booking cancelled before travel; invoice raised in error and voided.' : null,
      createdAt: issueDate,
      updatedAt: addDays(issueDate, rng.int(0, 8)),
    };
    invoices.push(invoice);

    // ── Payment receipt + history for anything actually collected ──────────
    if (paidAmount > 0) {
      const receiptId = ids.next('receipt');
      const paymentDate = addDays(issueDate, rng.int(1, 25));
      const method = rng.weighted([['bank_transfer', 5], ['card', 4], ['online', 2], ['cash', 1], ['cheque', 1]]);
      const receiptStatus = paidAmount >= totalAmount ? 'paid_in_full' : rng.chance(0.5) ? 'partial_payment' : 'paid_in_advance';
      const paymentType = paidAmount >= totalAmount ? rng.pick(['full_payment', 'final_payment']) : rng.chance(0.6) ? 'advance' : 'installment';
      const isCancelled = status === 'cancelled' && rng.chance(0.5);

      receipts.push({
        id: receiptId,
        receiptNumber: docNumber('REC', paymentDate, receiptId),
        leadId: lead.id,
        invoiceId,
        createdById: assignedToId,
        lastModifiedById: null,
        verifiedById: rng.chance(0.8) ? reps[0]?.id ?? assignedToId : null,
        reconciledById: rng.chance(0.6) ? reps[0]?.id ?? assignedToId : null,
        cancelledById: isCancelled ? assignedToId : null,
        refundForId: null,
        customerName,
        customerEmail,
        customerPhone: lead.phone ?? null,
        customerAddress: null,
        amount: paidAmount,
        currency: 'USD',
        paymentMethod: method,
        paymentDate,
        transactionId: txId(method, rng),
        receiptStatus: isCancelled ? 'cancelled' : receiptStatus,
        paymentType,
        notes: `${paymentType === 'advance' ? 'Advance' : 'Payment'} received against invoice ${invoice.invoiceNumber}.`,
        internalNotes: rng.chance(0.4) ? 'Matched to bank statement on the day of receipt.' : null,
        previousBalance: money(totalAmount),
        outstandingBalance: money(Math.max(0, totalAmount - paidAmount)),
        cardType: method === 'card' ? rng.pick(['visa', 'mastercard', 'amex']) : null,
        cardLastFour: method === 'card' ? String(rng.int(1000, 9999)) : null,
        bankName: ['bank_transfer', 'online'].includes(method) ? AGENCY.bankName : null,
        bankAccountNumber: method === 'bank_transfer' ? AGENCY.bankAccountNumber : null,
        bankTransactionRef: method === 'bank_transfer' ? `TRF${rng.int(100000, 999999)}` : null,
        chequeNumber: method === 'cheque' ? `CHQ-${rng.int(1000, 9999)}` : null,
        chequeDate: method === 'cheque' ? paymentDate : null,
        chequeBank: method === 'cheque' ? AGENCY.bankName : null,
        paymentGateway: method === 'online' ? rng.pick(['stripe', 'paypal']) : null,
        gatewayTransactionId: method === 'online' ? `pi_${rng.int(100000000, 999999999)}` : null,
        gatewayPaymentId: method === 'online' ? `pay_${rng.int(100000000, 999999999)}` : null,
        upiId: null,
        upiTransactionId: null,
        verified: rng.chance(0.85),
        verifiedAt: rng.chance(0.85) ? addDays(paymentDate, 1) : null,
        reconciled: rng.chance(0.6),
        reconciledAt: rng.chance(0.6) ? addDays(paymentDate, 3) : null,
        pdfUrl: `https://documents.lushtravelcloud.com/receipts/${receiptId}.pdf`,
        sentAt: addDays(paymentDate, rng.int(0, 1)),
        emailSent: true,
        whatsappSent: rng.chance(0.35),
        whatsappSentAt: rng.chance(0.35) ? addDays(paymentDate, 1) : null,
        cancelledAt: isCancelled ? addDays(paymentDate, rng.int(2, 20)) : null,
        cancellationReason: isCancelled ? 'Receipt voided following booking cancellation.' : null,
        refundReason: null,
        createdAt: paymentDate,
        updatedAt: addDays(paymentDate, rng.int(0, 4)),
      });

      const paymentHistoryId = ids.next('paymentHistory');
      const historyStatus = isCancelled
        ? 'cancelled'
        : rng.weighted([['reconciled', 5], ['verified', 4], ['pending', 2]]);
      paymentHistory.push({
        id: paymentHistoryId,
        paymentHistoryNumber: docNumber('PAY', paymentDate, paymentHistoryId),
        receiptId,
        leadId: lead.id,
        invoiceId,
        customerName,
        customerEmail,
        customerPhone: lead.phone ?? null,
        customerAddress: null,
        amount: paidAmount,
        currency: 'USD',
        paymentMethod: method,
        paymentDate,
        transactionId: txId(method, rng),
        paymentType: paymentType === 'final_payment' ? 'full_payment' : paymentType === 'advance' ? 'advance' : 'installment',
        status: historyStatus,
        notes: `Recorded against invoice ${invoice.invoiceNumber}.`,
        internalNotes: null,
        createdById: assignedToId,
        verifiedById: historyStatus === 'pending' ? null : reps[0]?.id ?? assignedToId,
        reconciledById: historyStatus === 'reconciled' ? reps[0]?.id ?? assignedToId : null,
        cancelledById: historyStatus === 'cancelled' ? assignedToId : null,
        verifiedAt: historyStatus !== 'pending' ? addDays(paymentDate, 1) : null,
        reconciledAt: historyStatus === 'reconciled' ? addDays(paymentDate, 3) : null,
        cancelledAt: historyStatus === 'cancelled' ? addDays(paymentDate, 5) : null,
        createdAt: paymentDate,
        updatedAt: addDays(paymentDate, rng.int(0, 5)),
      });
    }

    // ── Credit note where money had to go back ─────────────────────────────
    if ((status === 'cancelled' || rng.chance(0.06)) && paidAmount > 0) {
      const cnId = ids.next('creditNote');
      const creditAmount = money(paidAmount * (status === 'cancelled' ? 1 : 0.2));
      const type = status === 'cancelled' ? 'cancellation' : rng.pick(['discount', 'service_not_provided', 'quality_issue']);
      const refunded = rng.chance(0.6);
      creditNotes.push({
        id: cnId,
        creditNoteNumber: docNumber('CRN', issueDate, cnId),
        leadId: lead.id,
        invoiceId,
        createdById: assignedToId,
        lastModifiedById: null,
        approvedById: reps[0]?.id ?? assignedToId,
        rejectedById: null,
        cancelledById: null,
        customerName,
        customerEmail,
        customerPhone: lead.phone ?? '+94 11 745 2200',
        customerAddress: null,
        type,
        reason: type === 'cancellation'
          ? 'Booking cancelled before travel; deposit returned less supplier charges.'
          : 'Goodwill adjustment agreed with the traveller.',
        subtotal: creditAmount,
        taxAmount: 0,
        totalAmount: creditAmount,
        status: refunded ? 'refunded' : 'issued',
        refundStatus: refunded ? 'completed' : 'pending',
        refundMethod: refunded ? rng.pick(['bank_transfer', 'original_method', 'cheque']) : null,
        refundTransactionId: refunded ? `RFD${rng.int(100000, 999999)}` : null,
        refundProcessedAt: refunded ? addDays(issueDate, rng.int(5, 25)) : null,
        refundBankName: refunded ? AGENCY.bankName : null,
        refundAccountNumber: refunded ? AGENCY.bankAccountNumber : null,
        refundChequeNumber: null,
        refundNotes: refunded ? 'Refund completed and confirmed to the traveller by email.' : null,
        appliedToInvoice: !refunded,
        appliedAt: !refunded ? addDays(issueDate, rng.int(3, 15)) : null,
        voucherGenerated: false,
        voucherCode: null,
        voucherValue: null,
        voucherExpiryDate: null,
        issueDate,
        notes: `Credit raised against invoice ${invoice.invoiceNumber}.`,
        internalNotes: null,
        approvalRequired: true,
        approvedAt: addDays(issueDate, rng.int(1, 6)),
        rejectedAt: null,
        rejectionReason: null,
        pdfUrl: `https://documents.lushtravelcloud.com/credit-notes/${cnId}.pdf`,
        sentAt: addDays(issueDate, rng.int(1, 4)),
        emailSent: true,
        cancelledAt: null,
        cancellationReason: null,
        createdAt: issueDate,
        updatedAt: addDays(issueDate, rng.int(0, 10)),
      });
      creditNoteItems.push({
        id: ids.next('creditNoteItem'),
        creditNoteId: cnId,
        description: `Refund of payment received (${priced[0]?.description ?? 'travel arrangements'})`,
        originalAmount: paidAmount,
        creditAmount,
        quantity: 1,
        notes: null,
        order: 0,
      });
    }

    // ── Voucher for every confirmed booking ────────────────────────────────
    if (lead.status === 'CONFIRMED' && booking) {
      const voucherId = ids.next('voucher');
      const days = await db.lead.leadItineraryDay.findMany({
        where: { leadPackageSelectionId: selection.id },
        orderBy: { dayNumber: 'asc' },
        include: {
          places: { orderBy: { orderIndex: 'asc' } },
          activities: { orderBy: { orderIndex: 'asc' } },
        },
      });
      const leadFlights = await db.flight.flightBooking.findMany({
        where: { leadId: lead.id },
        include: { segments: { orderBy: { sequence: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      });

      vouchers.push({
        id: voucherId,
        voucherNumber: docNumber('VCH', issueDate, voucherId),
        leadId: lead.id,
        packageId: selection.packageId,
        customizedPackageId: null,
        createdById: assignedToId,
        lastModifiedById: null,
        customerName,
        customerEmail,
        customerPhone: lead.phone ?? null,
        customerAddress: null,
        packageDetails: {
          name: pkg?.title ?? selection.packageTitle,
          destination: pkg?.destination ?? lead.destination,
          duration: pkg?.durationDays ?? days.length,
          category: pkg?.category ?? null,
          inclusions: ['Accommodation as listed', 'Private transport with driver-guide', 'All excursions in the itinerary', 'Airport transfers'],
          exclusions: ['International flights', 'Travel insurance', 'Personal expenses'],
          highlights: days.slice(0, 4).map((d) => d.title).filter(Boolean),
          price: totalAmount,
          coverImage: { url: `https://picsum.photos/seed/${pkg?.slug ?? voucherId}-voucher/1200/800`, public_id: null },
          images: [{ url: `https://picsum.photos/seed/${pkg?.slug ?? voucherId}-voucher-1/1200/800`, public_id: null, isCover: true }],
        },
        travelStartDate: lead.travelDate,
        travelEndDate: lead.endDate,
        notes: `Please present this voucher at each service. Booking reference ${booking.id.slice(0, 8)}.`,
        terms: [
          'This voucher must be presented on arrival at each service.',
          'Services are non-transferable and valid only for the dates shown.',
          'Changes must be requested through Lush Travel Cloud at least 48 hours in advance.',
          'Not valid in conjunction with any other offer.',
        ],
        specialInstructions: rng.chance(0.5) ? ctx.fx.SPECIAL_REQUESTS[rng.int(0, ctx.fx.SPECIAL_REQUESTS.length - 1)] : null,
        status: addDays(now, -rng.int(0, 30)) > lead.endDate ? 'confirmed' : rng.weighted([['sent', 5], ['viewed', 3], ['confirmed', 2]]),
        emailSent: true,
        emailSentAt: addDays(issueDate, rng.int(1, 5)),
        whatsappSent: rng.chance(0.5),
        whatsappSentAt: rng.chance(0.5) ? addDays(issueDate, 2) : null,
        viewedAt: rng.chance(0.7) ? addDays(issueDate, rng.int(1, 8)) : null,
        confirmedAt: rng.chance(0.6) ? addDays(issueDate, rng.int(2, 10)) : null,
        pdfUrl: `https://documents.lushtravelcloud.com/vouchers/${voucherId}.pdf`,
        createdAt: issueDate,
        updatedAt: addDays(issueDate, rng.int(0, 8)),
      });

      for (const d of days) {
        const acc = d.accommodation && typeof d.accommodation === 'object' ? d.accommodation : {};
        voucherSummaries.push({
          id: ids.next('voucherItinerarySummary'),
          voucherId,
          dayNumber: d.dayNumber,
          title: d.title,
          locations: d.places.map((p) => placeNameById.get(p.placeId) ?? p.customName).filter(Boolean),
          activities: d.activities.map((a) => a.name).filter(Boolean),
          accommodationName: acc.name ?? null,
          accommodationType: acc.type ?? acc.roomType ?? null,
          order: d.dayNumber,
        });
        voucherMeals.push({
          id: ids.next('voucherMealPlan'),
          voucherId,
          dayNumber: d.dayNumber,
          dayTitle: d.title,
          breakfast: d.breakfastCount > 0,
          lunch: d.lunchCount > 0,
          dinner: d.dinnerCount > 0,
        });
        if (acc.name) {
          voucherLocations.push({
            id: ids.next('voucherLocationDate'),
            voucherId,
            location: (d.places[0] && placeNameById.get(d.places[0].placeId)) ?? pkg?.destination ?? null,
            hotelName: acc.name,
            checkIn: addDays(lead.travelDate, d.dayNumber - 1),
            checkOut: addDays(lead.travelDate, d.dayNumber),
            order: d.dayNumber,
          });
        }
      }

      for (const fb of leadFlights) {
        for (const seg of fb.segments) {
          voucherFlights.push({
            id: ids.next('voucherFlightSegment'),
            voucherId,
            dayNumber: fb.dayNumber ?? null,
            marketingCarrier: seg.marketingCarrier,
            flightNumber: seg.flightNumber,
            origin: seg.origin,
            destination: seg.destination,
            departureAt: seg.departureAt,
            arrivalAt: seg.arrivalAt,
            order: seg.sequence,
          });
        }
      }
    }

    if (booking) bookingBackfill.push({ bookingId: booking.id, invoiceId, invoiceNumber: invoice.invoiceNumber });
    const quote = quotationByLead.get(lead.id);
    if (quote && ['paid', 'partial', 'sent', 'viewed', 'overdue'].includes(status)) {
      quotationBackfill.push({ quotationId: quote.id, invoiceId, invoiceNumber: invoice.invoiceNumber, converted: lead.status === 'CONFIRMED' });
    }
  }

  // Parents first, then children — every child table carries a required FK.
  await db.bill.invoice.createMany({ data: invoices, skipDuplicates: true });
  await db.bill.invoiceItem.createMany({ data: invoiceItems, skipDuplicates: true });
  await db.bill.paymentReceipt.createMany({ data: receipts, skipDuplicates: true });
  await db.bill.paymentHistory.createMany({ data: paymentHistory, skipDuplicates: true });
  await db.bill.creditNote.createMany({ data: creditNotes, skipDuplicates: true });
  await db.bill.creditNoteItem.createMany({ data: creditNoteItems, skipDuplicates: true });
  await db.bill.voucher.createMany({ data: vouchers, skipDuplicates: true });
  if (voucherSummaries.length) await db.bill.voucherItinerarySummary.createMany({ data: voucherSummaries, skipDuplicates: true });
  if (voucherMeals.length) await db.bill.voucherMealPlan.createMany({ data: voucherMeals, skipDuplicates: true });
  if (voucherLocations.length) await db.bill.voucherLocationDate.createMany({ data: voucherLocations, skipDuplicates: true });
  if (voucherFlights.length) await db.bill.voucherFlightSegment.createMany({ data: voucherFlights, skipDuplicates: true });

  for (const b of bookingBackfill) {
    await db.book.booking.update({ where: { id: b.bookingId }, data: { invoiceId: b.invoiceId } });
  }
  for (const q of quotationBackfill) {
    await db.bill.quotation.update({
      where: { id: q.quotationId },
      data: { convertedToInvoiceId: q.converted ? q.invoiceId : null },
    });
  }

  const revenue = money(invoices.reduce((s, i) => s + i.paidAmount, 0));
  const outstanding = money(invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.outstandingAmount, 0));

  log(`    billing: ${invoices.length} invoices · ${receipts.length} receipts · ${vouchers.length} vouchers · collected USD ${revenue}`);

  return {
    summary: `${invoices.length} invoices · ${receipts.length} receipts · ${vouchers.length} vouchers`,
    invoices: invoices.length,
    receipts: receipts.length,
    vouchers: vouchers.length,
    creditNotes: creditNotes.length,
    revenue,
    outstanding,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** How much of an invoice has actually been collected, given its state. */
function paidFor({ status, total, booking, rng }) {
  if (status === 'cancelled') {
    if (!booking) return 0;
    return money(booking.paidAmount ?? 0);
  }
  if (booking && booking.paidAmount > 0) return money(booking.paidAmount);
  return money(total * rng.weighted([[0.25, 3], [0.5, 2], [0.3, 2]]));
}

function txId(method, rng) {
  switch (method) {
    case 'card': return `ch_${rng.int(10000000, 99999999)}`;
    case 'bank_transfer': return `TRF${rng.int(100000, 999999)}`;
    case 'online': return `pi_${rng.int(100000000, 999999999)}`;
    case 'cheque': return `CHQ-${rng.int(1000, 9999)}`;
    default: return `RCPT${rng.int(10000, 99999)}`;
  }
}

export { isoDay };
