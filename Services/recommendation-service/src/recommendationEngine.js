const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const countOf = (signal) => number(signal?.count);
const idsOf = (signal) => Array.isArray(signal?.ids) ? signal.ids.filter(Boolean) : [];
const recommendationSignals = Object.freeze({
  'quotes.unconverted': ['unconvertedQuotes'],
  'bookings.departures-outstanding': ['departuresOutstanding'],
  'leads.unassigned': ['unassignedLeads'],
  'leads.quoted-silence': ['quotedSilence'],
  'leads.cold': ['coldLeads'],
  'leads.stalled-drafting': ['stalledDrafting'],
  'billing.expiring-quotes': ['expiringQuotes'],
  'billing.overdue-invoices': ['agingOverdue'],
  'billing.partial-payments': ['partialAging'],
  'billing.low-margin-bookings': ['lowMarginBookings'],
  'bookings.voucher-missing': ['voucherMissing'],
  'billing.no-deposit': ['noDeposit'],
  'packages.no-recent-inquiries': ['silentPackages'],
  'packages.low-recorded-bookings': ['packagesLowBookings'],
  'packages.low-views': ['packagesLowViews'],
  'packages.low-inquiries': ['packagesLowInquiries'],
  'packages.low-conversion': ['packagesLowConversions'],
  'packages.no-confirmed-conversions': ['packagesNoConversions'],
  'packages.below-median-rating': ['packagesLowRating'],
  'packages.below-median-reviews': ['packagesLowReviews'],
  'quotes.lost-value': ['lostQuotes'],
  'customers.lapsed-repeat': ['lapsedCustomers'],
  'flights.upcoming-unticketed': ['flightsNeedingReview'],
  'hotels.unresolved-statuses': ['hotelOverview', 'hotelsNeedingReview'],
  'hotels.upcoming-unconfirmed': ['hotelsNeedingReview'],
  'users.unverified-accounts': ['unverifiedCustomerAccounts'],
  'analytics.past-travel-still-confirmed': ['bookingOverview'],
  'analytics.aging-pending-bookings': ['bookingOverview'],
  'revenue.destination-concentration': ['destinationConcentration'],
  'analytics.conversion-decline': ['conversionTrend'],
  'analytics.response-time-increasing': ['responseTimeTrend'],
  'analytics.cancellation-increase': ['cancellationSpike'],
});
export const VERIFIED_RECOMMENDATION_KEYS = Object.freeze(Object.keys(recommendationSignals));

function recommendation({
  key,
  category,
  module,
  priority = 'medium',
  title,
  summary,
  signal,
  evidence = [],
  actionLabel,
  actionTab,
}) {
  return {
    key,
    category,
    module,
    priority,
    title,
    summary,
    evidence,
    relatedRecordIds: idsOf(signal),
    action: { label: actionLabel, module, ...(actionTab ? { tab: actionTab } : {}) },
    sourceSignals: recommendationSignals[key] || [],
  };
}

function countEvidence(signal, label = 'Affected records') {
  return [{ label, value: countOf(signal) }];
}

export function buildRecommendations(signals = {}) {
  const recommendations = [];
  const addWhenCount = (signalName, build) => {
    const signal = signals[signalName];
    if (countOf(signal) > 0) recommendations.push(build(signal));
  };

  const unconvertedQuotes = signals.unconvertedQuotes;
  if (countOf(unconvertedQuotes) >= 3 && number(unconvertedQuotes.value) >= 1_000) {
    recommendations.push(recommendation({
      key: 'quotes.unconverted', category: 'sales', module: 'billing', priority: 'high',
      title: 'Follow up on recent quotations',
      summary: `${countOf(unconvertedQuotes)} sent or viewed quotations worth ${number(unconvertedQuotes.value)} remain unconverted.`,
      signal: unconvertedQuotes,
      evidence: [...countEvidence(unconvertedQuotes, 'Unconverted quotations'), { label: 'Quoted value', value: unconvertedQuotes.value }, { label: 'Oldest quote age', value: `${number(unconvertedQuotes.oldestAgeDays)} days` }],
      actionLabel: 'Review quotations',
      actionTab: 'quotation',
    }));
  }

  const departuresOutstanding = signals.departuresOutstanding;
  if (countOf(departuresOutstanding) > 0 && number(departuresOutstanding.value) >= 1_000) {
    const count = countOf(departuresOutstanding);
    recommendations.push(recommendation({
      key: 'bookings.departures-outstanding', category: 'finance', module: 'billing', priority: 'high',
      title: 'Follow up on payments before departure',
      summary: `${count} confirmed booking${count === 1 ? '' : 's'} departing within 14 days ${count === 1 ? 'has' : 'have'} outstanding payments.`,
      signal: departuresOutstanding,
      evidence: [...countEvidence(departuresOutstanding, 'Confirmed bookings'), { label: 'Outstanding amount', value: departuresOutstanding.value }, ...(departuresOutstanding.nearestDeparture ? [{ label: 'Nearest departure', value: departuresOutstanding.nearestDeparture }] : [])],
      actionLabel: 'Review invoices',
      actionTab: 'invoice',
    }));
  }

  addWhenCount('unassignedLeads', (signal) => recommendation({
    key: 'leads.unassigned', category: 'operations', module: 'leads', priority: 'high',
    title: 'Review unassigned leads',
    summary: `${countOf(signal)} new leads have no assigned sales representative.`,
    signal,
    evidence: [...countEvidence(signal), ...(signal.oldestCreatedAt ? [{ label: 'Oldest unassigned lead', value: signal.oldestCreatedAt }] : [])],
    actionLabel: 'Review leads',
  }));

  addWhenCount('quotedSilence', (signal) => recommendation({
    key: 'leads.quoted-silence', category: 'sales', module: 'leads', priority: 'high',
    title: 'Follow up on quiet quotations',
    summary: `${countOf(signal)} quoted leads have no communication recorded in the last seven days.`,
    signal,
    evidence: [...countEvidence(signal, 'Quoted leads'), { label: 'Oldest without recorded contact', value: `${number(signal.oldestAgeDays)} days` }],
    actionLabel: 'Review follow-ups',
  }));

  addWhenCount('coldLeads', (signal) => recommendation({
    key: 'leads.cold', category: 'sales', module: 'leads', priority: number(signal.oldestAgeDays) >= 14 ? 'high' : 'medium',
    title: 'Review leads without recent activity',
    summary: `${countOf(signal)} active leads have had no recorded update for at least seven days.`,
    signal,
    evidence: [...countEvidence(signal, 'Active leads'), { label: 'Oldest activity gap', value: `${number(signal.oldestAgeDays)} days` }],
    actionLabel: 'Review leads',
  }));

  addWhenCount('stalledDrafting', (signal) => recommendation({
    key: 'leads.stalled-drafting', category: 'operations', module: 'leads',
    title: 'Review stalled quotations in progress',
    summary: `${countOf(signal)} leads in drafting have not been updated for at least seven days.`,
    signal,
    evidence: [...countEvidence(signal, 'Drafting leads'), { label: 'Oldest draft age', value: `${number(signal.oldestAgeDays)} days` }],
    actionLabel: 'Review drafts',
  }));

  addWhenCount('expiringQuotes', (signal) => recommendation({
    key: 'billing.expiring-quotes', category: 'sales', module: 'billing', priority: 'high',
    title: 'Review quotations nearing expiry',
    summary: `${countOf(signal)} sent or viewed quotations expire within five days.`,
    signal,
    evidence: [...countEvidence(signal, 'Quotations'), { label: 'Earliest expiry', value: signal.earliestExpiry }, { label: 'Quoted amount', value: signal.value }],
    actionLabel: 'Review quotations',
    actionTab: 'quotation',
  }));

  addWhenCount('agingOverdue', (signal) => recommendation({
    key: 'billing.overdue-invoices', category: 'finance', module: 'billing', priority: 'high',
    title: 'Review overdue invoices',
    summary: `${countOf(signal)} invoices are overdue with an outstanding balance.`,
    signal,
    evidence: [...countEvidence(signal, 'Overdue invoices'), { label: 'Outstanding amount', value: signal.value }, { label: 'Oldest overdue', value: `${number(signal.oldestDays)} days` }],
    actionLabel: 'Review invoices',
    actionTab: 'invoice',
  }));

  addWhenCount('partialAging', (signal) => recommendation({
    key: 'billing.partial-payments', category: 'finance', module: 'billing', priority: 'high',
    title: 'Review overdue partial payments',
    summary: `${countOf(signal)} partially paid invoices remain overdue.`,
    signal,
    evidence: [...countEvidence(signal, 'Invoices'), { label: 'Outstanding amount', value: signal.value }, { label: 'Oldest overdue', value: `${number(signal.oldestDays)} days` }],
    actionLabel: 'Review payments',
    actionTab: 'invoice',
  }));

  addWhenCount('lowMarginBookings', (signal) => recommendation({
    key: 'billing.low-margin-bookings', category: 'finance', module: 'billing', priority: 'high',
    title: 'Investigate low-margin bookings',
    summary: `${countOf(signal)} confirmed bookings have a recorded margin below five percent.`,
    signal,
    evidence: [...countEvidence(signal, 'Confirmed bookings'), { label: 'Average recorded margin', value: `${number(signal.avgMargin)}%` }, { label: 'Booking value', value: signal.value }],
    actionLabel: 'Review margins',
  }));

  addWhenCount('voucherMissing', (signal) => recommendation({
    key: 'bookings.voucher-missing', category: 'operations', module: 'billing', priority: 'high',
    title: 'Check missing travel vouchers',
    summary: `${countOf(signal)} confirmed trips departing within seven days have no voucher recorded.`,
    signal,
    evidence: countEvidence(signal, 'Upcoming trips'),
    actionLabel: 'Review documents',
  }));

  addWhenCount('noDeposit', (signal) => recommendation({
    key: 'billing.no-deposit', category: 'finance', module: 'billing', priority: 'high',
    title: 'Review upcoming trips without a deposit',
    summary: `${countOf(signal)} confirmed trips within 30 days have no recorded payment.`,
    signal,
    evidence: [...countEvidence(signal, 'Upcoming trips'), { label: 'Unpaid amount', value: signal.value }],
    actionLabel: 'Review payments',
  }));

  addWhenCount('silentPackages', (signal) => recommendation({
    key: 'packages.no-recent-inquiries', category: 'packages', module: 'packages',
    title: 'Review packages with no recent inquiries',
    summary: `${countOf(signal)} active packages had no package selection recorded in the last 30 days.`,
    signal,
    evidence: countEvidence(signal, 'Active packages'),
    actionLabel: 'Review packages',
  }));

  addWhenCount('packagesLowBookings', (signal) => recommendation({
    key: 'packages.low-recorded-bookings', category: 'packages', module: 'packages',
    title: 'Investigate packages with below-median bookings',
    summary: `${countOf(signal)} active packages average ${number(signal.averageRecordedBookings)} recorded bookings, below the package median of ${number(signal.benchmarkRecordedBookings)}.`,
    signal,
    evidence: [...countEvidence(signal, 'Below-median packages'), { label: 'Average recorded bookings', value: signal.averageRecordedBookings }, { label: 'Package median', value: signal.benchmarkRecordedBookings }],
    actionLabel: 'Review packages',
  }));

  addWhenCount('packagesLowViews', (signal) => recommendation({
    key: 'packages.low-views', category: 'packages', module: 'packages',
    title: 'Improve visibility for under-viewed packages',
    summary: `${countOf(signal)} active packages average ${number(signal.averageRecordedViews)} recorded views, below the package median of ${number(signal.benchmarkRecordedViews)}.`,
    signal,
    evidence: [...countEvidence(signal, 'Below-median packages'), { label: 'Average recorded views', value: signal.averageRecordedViews }, { label: 'Package median', value: signal.benchmarkRecordedViews }],
    actionLabel: 'Review packages',
  }));

  addWhenCount('packagesLowInquiries', (signal) => recommendation({
    key: 'packages.low-inquiries', category: 'packages', module: 'packages',
    title: 'Investigate packages with fewer inquiries',
    summary: `${countOf(signal)} active packages average ${number(signal.averageInquiries90Days)} inquiries in 90 days, below the package median of ${number(signal.benchmarkInquiries90Days)}.`,
    signal,
    evidence: [...countEvidence(signal, 'Below-median packages'), { label: 'Average inquiries, 90 days', value: signal.averageInquiries90Days }, { label: 'Package median', value: signal.benchmarkInquiries90Days }],
    actionLabel: 'Review packages',
  }));

  addWhenCount('packagesLowConversions', (signal) => recommendation({
    key: 'packages.low-conversion', category: 'packages', module: 'packages',
    title: 'Review packages with below-median conversion',
    summary: `${countOf(signal)} packages with sufficient inquiry history average ${number(signal.averageConversionRate90Days)}% confirmed conversion, below the package median of ${number(signal.benchmarkConversionRate90Days)}%.`,
    signal,
    evidence: [...countEvidence(signal, 'Below-median packages'), { label: 'Average confirmed conversion, 90 days', value: signal.averageConversionRate90Days }, { label: 'Package median conversion', value: signal.benchmarkConversionRate90Days }, { label: 'Qualified packages', value: signal.qualifiedPackages }],
    actionLabel: 'Review packages',
  }));

  addWhenCount('packagesNoConversions', (signal) => recommendation({
    key: 'packages.no-confirmed-conversions', category: 'packages', module: 'packages',
    title: 'Investigate packages with inquiries but no conversions',
    summary: `${countOf(signal)} packages received at least three inquiries in 90 days but had no confirmed lead; their average was ${number(signal.averageInquiries90Days)} inquiries.`,
    signal,
    evidence: [...countEvidence(signal, 'Packages with no confirmed leads'), { label: 'Average inquiries, 90 days', value: signal.averageInquiries90Days }, { label: 'Packages qualified for comparison', value: signal.qualifiedPackages }],
    actionLabel: 'Review packages',
  }));

  addWhenCount('packagesLowRating', (signal) => recommendation({
    key: 'packages.below-median-rating', category: 'packages', module: 'packages',
    title: 'Review packages with lower customer ratings',
    summary: `${countOf(signal)} packages with at least three reviews average ${number(signal.averageRating)} stars, below the qualified package median of ${number(signal.benchmarkRating)}.`,
    signal,
    evidence: [...countEvidence(signal, 'Below-median packages'), { label: 'Average rating', value: signal.averageRating }, { label: 'Qualified package median', value: signal.benchmarkRating }, { label: 'Qualified packages', value: signal.qualifiedPackages }],
    actionLabel: 'Review packages',
  }));

  addWhenCount('packagesLowReviews', (signal) => recommendation({
    key: 'packages.below-median-reviews', category: 'packages', module: 'packages',
    title: 'Increase review collection for under-reviewed packages',
    summary: `${countOf(signal)} active packages average ${number(signal.averageReviews)} reviews, below the package median of ${number(signal.benchmarkReviews)}.`,
    signal,
    evidence: [...countEvidence(signal, 'Below-median packages'), { label: 'Average reviews', value: signal.averageReviews }, { label: 'Package median', value: signal.benchmarkReviews }],
    actionLabel: 'Review packages',
  }));

  const lostQuotes = signals.lostQuotes;
  if (countOf(lostQuotes) >= 3 && number(lostQuotes.value) >= 2_000) {
    recommendations.push(recommendation({
      key: 'quotes.lost-value', category: 'sales', module: 'billing', priority: 'medium',
      title: 'Review recently lost quotations',
      summary: `${countOf(lostQuotes)} quotations worth ${number(lostQuotes.value)} were rejected or expired this month.`,
      signal: lostQuotes,
      evidence: [...countEvidence(lostQuotes, 'Lost quotations'), { label: 'Quoted value', value: lostQuotes.value }, { label: 'Rejected with a reason', value: number(lostQuotes.rejectedWithReason) }],
      actionLabel: 'Review quotations',
      actionTab: 'quotation',
    }));
  }

  const lapsedCustomers = signals.lapsedCustomers;
  if (countOf(lapsedCustomers) >= 3) {
    recommendations.push(recommendation({
      key: 'customers.lapsed-repeat', category: 'sales', module: 'leads', priority: 'medium',
      title: 'Reconnect with past customers',
      summary: `${countOf(lapsedCustomers)} customers who travelled around this time last year have not booked again this year.`,
      signal: lapsedCustomers,
      evidence: [...countEvidence(lapsedCustomers, 'Past customers'), ...(lapsedCustomers.lastTripDate ? [{ label: 'Most recent qualifying trip', value: lapsedCustomers.lastTripDate }] : [])],
      actionLabel: 'Review customers',
    }));
  }

  addWhenCount('flightsNeedingReview', (signal) => recommendation({
    key: 'flights.upcoming-unticketed', category: 'operations', module: 'flights', priority: 'high',
    title: 'Review upcoming flights awaiting ticketing',
    summary: `${countOf(signal)} upcoming flight booking${countOf(signal) === 1 ? '' : 's'} ${countOf(signal) === 1 ? 'is' : 'are'} not ticketed.`,
    signal,
    evidence: [...countEvidence(signal, 'Flight bookings'), ...(signal.nearestDeparture ? [{ label: 'Nearest departure', value: signal.nearestDeparture }] : [])],
    actionLabel: 'Review flights',
    actionTab: 'bookings',
  }));

  const hotelOverview = signals.hotelOverview;
  const unresolvedHotels = number(hotelOverview?.pendingHotels) + number(hotelOverview?.failedHotels);
  if (unresolvedHotels > 0) {
    const upcomingHotels = signals.hotelsNeedingReview;
    const upcomingCount = countOf(upcomingHotels);
    recommendations.push(recommendation({
      key: 'hotels.unresolved-statuses', category: 'operations', module: 'hotels', priority: 'high',
      title: upcomingCount > 0 ? 'Resolve upcoming hotel booking issues' : 'Review pending and failed hotel bookings',
      summary: `${number(hotelOverview.pendingHotels)} hotel booking${number(hotelOverview.pendingHotels) === 1 ? ' is' : 's are'} pending and ${number(hotelOverview.failedHotels)} ${number(hotelOverview.failedHotels) === 1 ? 'has' : 'have'} failed. Review these records to confirm or resolve each stay.${upcomingCount > 0 ? ` ${upcomingCount} need attention within seven days.` : ''}`,
      signal: { ids: hotelOverview.ids || upcomingHotels?.ids || [] },
      evidence: [
        { label: 'Pending hotel bookings', value: number(hotelOverview.pendingHotels) },
        { label: 'Failed hotel bookings', value: number(hotelOverview.failedHotels) },
        { label: 'Total hotel bookings', value: number(hotelOverview.totalHotelBookings) },
        ...(upcomingCount > 0 ? countEvidence(upcomingHotels, 'Check-ins within seven days') : []),
        ...(upcomingHotels?.nearestCheckin ? [{ label: 'Nearest check-in', value: upcomingHotels.nearestCheckin }] : []),
      ],
      actionLabel: 'Review hotel bookings',
      actionTab: 'bookings',
    }));
  } else {
    addWhenCount('hotelsNeedingReview', (signal) => recommendation({
      key: 'hotels.upcoming-unconfirmed', category: 'operations', module: 'hotels', priority: 'high',
      title: 'Review upcoming hotel reservations',
      summary: `${countOf(signal)} upcoming hotel reservation${countOf(signal) === 1 ? '' : 's'} ${countOf(signal) === 1 ? 'is' : 'are'} pending or failed.`,
      signal,
      evidence: [...countEvidence(signal, 'Hotel reservations'), ...(signal.nearestCheckin ? [{ label: 'Nearest check-in', value: signal.nearestCheckin }] : [])],
      actionLabel: 'Review hotels',
      actionTab: 'bookings',
    }));
  }

  const unverifiedCustomerAccounts = signals.unverifiedCustomerAccounts;
  if (countOf(unverifiedCustomerAccounts) > 0) {
    recommendations.push(recommendation({
      key: 'users.unverified-accounts', category: 'operations', module: 'users', priority: 'medium',
      title: 'Review unverified customer accounts',
      summary: `${countOf(unverifiedCustomerAccounts)} customer account${countOf(unverifiedCustomerAccounts) === 1 ? '' : 's'} are unverified (${number(unverifiedCustomerAccounts.ratePct)}% of website customers). Review the verification queue and follow up where needed.`,
      signal: unverifiedCustomerAccounts,
      evidence: [
        { label: 'Unverified customers', value: countOf(unverifiedCustomerAccounts) },
        { label: 'Unverified rate', value: `${number(unverifiedCustomerAccounts.ratePct)}%` },
      ],
      actionLabel: 'Review customers',
      actionTab: 'website-users',
    }));
  }

  const bookingOverview = signals.bookingOverview;
  if (number(bookingOverview?.pastTravelStillConfirmed) > 0) {
    recommendations.push(recommendation({
      key: 'analytics.past-travel-still-confirmed', category: 'operations', module: 'analytics', priority: 'medium',
      title: 'Reconcile bookings after travel',
      summary: `${number(bookingOverview.pastTravelStillConfirmed)} booking${number(bookingOverview.pastTravelStillConfirmed) === 1 ? ' has' : 's have'} a past travel date but are still marked confirmed. Review whether their lifecycle status needs updating.`,
      signal: { ids: [] },
      evidence: [{ label: 'Past travel still marked confirmed', value: number(bookingOverview.pastTravelStillConfirmed) }],
      actionLabel: 'Review booking analytics',
    }));
  }
  if (number(bookingOverview?.pendingBookingsOver7Days) > 0) {
    recommendations.push(recommendation({
      key: 'analytics.aging-pending-bookings', category: 'operations', module: 'analytics', priority: 'medium',
      title: 'Review aging pending bookings',
      summary: `${number(bookingOverview.pendingBookingsOver7Days)} booking${number(bookingOverview.pendingBookingsOver7Days) === 1 ? ' has' : 's have'} remained pending for more than seven days. Review the outstanding booking queue.`,
      signal: { ids: [] },
      evidence: [{ label: 'Pending more than seven days', value: number(bookingOverview.pendingBookingsOver7Days) }],
      actionLabel: 'Review booking analytics',
    }));
  }

  const concentration = signals.destinationConcentration;
  if (concentration?.destination && number(concentration.share) >= 35 && number(concentration.share) - number(concentration.baseline) >= 15) {
    recommendations.push(recommendation({
      key: 'revenue.destination-concentration', category: 'performance', module: 'analytics', priority: 'medium',
      title: 'Review destination revenue concentration',
      summary: `${number(concentration.share)}% of this month's revenue comes from ${concentration.destination}, compared with ${number(concentration.baseline)}% over the previous six months.`,
      signal: { ids: [] },
      evidence: [
        { label: 'Top destination', value: concentration.destination },
        { label: 'This month', value: `${number(concentration.share)}%` },
        { label: 'Previous six months', value: `${number(concentration.baseline)}%` },
      ],
      actionLabel: 'Review revenue mix',
    }));
  }

  const trend = signals.conversionTrend;
  const currentRate = trend?.curTotal >= 5 ? number(trend.curWon) / number(trend.curTotal) : null;
  const previousRate = trend?.prevTotal >= 5 ? number(trend.prevWon) / number(trend.prevTotal) : null;
  if (currentRate !== null && previousRate !== null && currentRate < previousRate) {
    recommendations.push(recommendation({
      key: 'analytics.conversion-decline', category: 'performance', module: 'analytics', priority: 'high',
      title: 'Investigate the conversion-rate decline',
      summary: 'The share of leads converted in the latest 30-day period is below the previous 30-day period.',
      signal: { ids: [] },
      evidence: [
        { label: 'Latest 30 days', value: `${Math.round(currentRate * 100)}% (${trend.curWon}/${trend.curTotal})` },
        { label: 'Previous 30 days', value: `${Math.round(previousRate * 100)}% (${trend.prevWon}/${trend.prevTotal})` },
      ],
      actionLabel: 'Review analytics',
    }));
  }

  const responseTime = signals.responseTimeTrend;
  if (responseTime?.curN >= 5 && responseTime?.prevN >= 5 && number(responseTime.curHours) > number(responseTime.prevHours) * 1.25) {
    recommendations.push(recommendation({
      key: 'analytics.response-time-increasing', category: 'operations', module: 'analytics',
      title: 'Investigate slower quotation response times',
      summary: 'The median time to send a quotation has increased compared with the previous period.',
      signal: { ids: [] },
      evidence: [
        { label: 'Latest median', value: `${number(responseTime.curHours)} hours (${responseTime.curN} quotations)` },
        { label: 'Previous median', value: `${number(responseTime.prevHours)} hours (${responseTime.prevN} quotations)` },
      ],
      actionLabel: 'Review analytics',
    }));
  }

  const cancellations = signals.cancellationSpike;
  if (number(cancellations?.baseline) >= 1 && number(cancellations?.cur) > number(cancellations.baseline) * 1.5) {
    recommendations.push(recommendation({
      key: 'analytics.cancellation-increase', category: 'performance', module: 'analytics', priority: 'high',
      title: 'Investigate increased cancellations',
      summary: 'Cancellations this month are above the recent three-month monthly average.',
      signal: { ids: [] },
      evidence: [
        { label: 'This month', value: number(cancellations.cur) },
        { label: 'Recent monthly average', value: number(cancellations.baseline) },
      ],
      actionLabel: 'Review analytics',
    }));
  }

  return recommendations;
}