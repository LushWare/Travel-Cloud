// Sets every saved package transport row (not flights) to the agency's Settings
// rate for its vehicle and pricing model, then recalculates package prices.
// Dry run by default; pass --commit to write.
import 'dotenv/config';
import prisma from '../src/db/client.js';
import { getPricingDefaults } from '../src/config/orgSettings.js';
import { repricePackages } from '../src/services/package.service.js';

const COMMIT = process.argv.includes('--commit');

/** The Settings rate for a row: its own pricing model, else the vehicle's default model. Null when the vehicle has none. */
export function settingsRateFor(row, transportRates = {}) {
  const rates = transportRates[row.transportMode];
  if (!rates) return null;
  const own = Number(rates[row.pricingModel]);
  if (own > 0) return { pricingModel: row.pricingModel, unitCost: own };
  const fallback = Number(rates[rates.pricingModel]);
  return fallback > 0 ? { pricingModel: rates.pricingModel, unitCost: fallback } : null;
}

try {
  const { transportRates = {}, mealPrices } = await getPricingDefaults({ fresh: true });
  const rows = await prisma.packageDayTransport.findMany({
    where: { transportMode: { not: 'FLIGHT' } },
    select: { id: true, transportMode: true, pricingModel: true, unitCost: true, distanceKm: true },
  });

  const updates = [];
  const noRate = [];
  for (const row of rows) {
    const rate = settingsRateFor(row, transportRates);
    if (!rate) { noRate.push(row.transportMode); continue; }
    if (rate.pricingModel === row.pricingModel && Number(row.unitCost) === rate.unitCost) continue;
    updates.push({ id: row.id, from: `${row.transportMode} ${row.pricingModel} ${Number(row.unitCost)}`, to: rate });
  }

  const summary = {};
  for (const u of updates) {
    const key = `${u.from} → ${u.to.pricingModel} ${u.to.unitCost}`;
    summary[key] = (summary[key] || 0) + 1;
  }
  console.log(`${rows.length} vehicle rows; ${updates.length} to update; ${noRate.length} without a Settings rate (left as is)`);
  console.table(Object.entries(summary).map(([change, count]) => ({ change, count })));

  if (COMMIT && updates.length > 0) {
    // One small statement per vehicle + pricing model, instead of a long batch that holds locks.
    const groups = new Map();
    for (const row of rows) {
      const rate = settingsRateFor(row, transportRates);
      if (!rate) continue;
      groups.set(`${row.transportMode}|${row.pricingModel}`, { transportMode: row.transportMode, pricingModel: row.pricingModel, rate });
    }
    for (const g of groups.values()) {
      const { count } = await prisma.packageDayTransport.updateMany({
        where: { transportMode: g.transportMode, pricingModel: g.pricingModel },
        data: { pricingModel: g.rate.pricingModel, unitCost: g.rate.unitCost },
      });
      console.log(`${g.transportMode} ${g.pricingModel}: ${count} row(s) → ${g.rate.pricingModel} ${g.rate.unitCost}`);
    }
  }

  const prices = await repricePackages({ commit: COMMIT, mealPrices });
  console.log(COMMIT
    ? `Updated ${updates.length} transport row(s) and ${prices.changed} package price(s).`
    : `Package prices that would change: ${prices.changed} of ${prices.total}. Nothing written — run with --commit.`);
} finally {
  await prisma.$disconnect();
}
