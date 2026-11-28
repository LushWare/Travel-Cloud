import 'dotenv/config';
import prisma from '../src/db/client.js';
import { repricePackages } from '../src/services/package.service.js';
import { getPricingDefaults } from '../src/config/orgSettings.js';

const COMMIT = process.argv.includes('--commit');

try {
  const { mealPrices } = await getPricingDefaults({ fresh: true });
  const result = await repricePackages({ commit: COMMIT, mealPrices });
  console.table(result.packages.map((r) => ({
    package: r.title.slice(0, 36), active: r.isActive, 'price now': r.oldPrice, 'price new': r.newPrice,
    change: Math.round((r.newPrice - r.oldPrice) * 100) / 100,
  })));
  console.log(COMMIT
    ? `Updated ${result.changed} of ${result.total} package price(s).`
    : `${result.changed} of ${result.total} package price(s) would change. Nothing was written — run again with --commit to apply.`);
} finally {
  await prisma.$disconnect();
}
