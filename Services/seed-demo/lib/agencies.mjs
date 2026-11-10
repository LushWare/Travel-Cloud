/**
 * The test agencies the demo seed builds (Phase 1). lush-demo holds the existing data; the other
 * two get their own copy of the same book of business — same customer names, package slugs and
 * invoice numbers — so the isolation tests prove each agency only ever sees its own rows.
 */
import { DEMO_TENANT_ID } from '../../shared/constants/src/index.js';

export const AGENCIES = [
  { index: 0, id: DEMO_TENANT_ID, slug: 'lush-demo', name: 'Lush Demo', isDemo: true },
  { index: 1, id: '00000000-0000-4000-8000-000000000002', slug: 'acme-tours', name: 'Acme Tours', isDemo: false },
  { index: 2, id: '00000000-0000-4000-8000-000000000003', slug: 'globe-dmc', name: 'Globe DMC', isDemo: false },
];

/** One person in two agencies with a different role in each — exercises the agency picker. */
export const CONSULTANT = {
  email: 'consultant@lushtravelcloud.com',
  name: 'Kavindi Perera',
  memberships: [
    { agency: 'acme-tours', role: 'salesRep', permissions: ['manage_leads', 'view_billing', 'view_reports'] },
    { agency: 'globe-dmc', role: 'admin', permissions: ['manage_users', 'manage_leads', 'manage_packages', 'view_reports', 'manage_billing', 'view_billing'] },
  ],
};

export function selectAgencies(slugs) {
  if (!slugs) return AGENCIES;
  const unknown = slugs.filter((s) => !AGENCIES.some((a) => a.slug === s));
  if (unknown.length) throw new Error(`Unknown agency: ${unknown.join(', ')} (known: ${AGENCIES.map((a) => a.slug).join(', ')})`);
  return AGENCIES.filter((a) => slugs.includes(a.slug));
}

/**
 * One email is one login account, so each test agency's staff and vendors are different people:
 * lush-demo keeps the fixture addresses, other agencies get name+agency@domain.
 */
export const agencyEmail = (email, agency) => {
  if (agency.isDemo) return email;
  const [local, domain] = email.split('@');
  return `${local}+${agency.slug}@${domain}`;
};
