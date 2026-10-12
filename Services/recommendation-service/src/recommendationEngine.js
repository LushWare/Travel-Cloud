const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const countOf = (signal) => number(signal?.count);
const idsOf = (signal) => Array.isArray(signal?.ids) ? signal.ids.filter(Boolean) : [];

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

  addWhenCount('flightsNeedingReview', (signal) => recommendation({
    key: 'flights.upcoming-unconfirmed', category: 'operations', module: 'flights', priority: 'high',
    title: 'Review upcoming flights awaiting confirmation',
    summary: `${countOf(signal)} flight bookings for departures within seven days are not ticketed.`,
    signal,
    evidence: [...countEvidence(signal, 'Flight bookings'), ...(signal.nearestDeparture ? [{ label: 'Nearest departure', value: signal.nearestDeparture }] : [])],
    actionLabel: 'Review flights',
    actionTab: 'bookings',
  }));

  addWhenCount('hotelsNeedingReview', (signal) => recommendation({
    key: 'hotels.upcoming-unconfirmed', category: 'operations', module: 'hotels', priority: 'high',
    title: 'Review upcoming hotel reservations',
    summary: `${countOf(signal)} hotel reservations for check-ins within seven days are pending or failed.`,
    signal,
    evidence: [...countEvidence(signal, 'Hotel reservations'), ...(signal.nearestCheckin ? [{ label: 'Nearest check-in', value: signal.nearestCheckin }] : [])],
    actionLabel: 'Review hotels',
    actionTab: 'bookings',
  }));

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