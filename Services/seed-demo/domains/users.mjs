/**
 * crm_users — staff, customers, vendors, the organisation singleton and the
 * policy documents the assistant cites.
 *
 * Existing accounts are never modified. Demo accounts are upserted by their
 * deterministic id, so a re-run refreshes them rather than duplicating, and
 * their passwords are hashed at runtime from one documented demo password per
 * role — which means every account this script creates can actually be logged
 * into during a demo, unlike the older extended seed whose bcrypt constants
 * have no known plaintext.
 */
import bcrypt from '../../user-service/node_modules/bcryptjs/index.js';
import { id as idFor } from '../lib/ids.mjs';
import { requireTenantId } from '../../shared/tenancy/src/index.js';
import { agencyEmail } from '../lib/agencies.mjs';
import { AGENCY, CUSTOMERS, POLICY_DOCUMENTS, STAFF, VENDORS } from '../lib/fixtures.mjs';

/** One password per role, so a demo can log in as anyone it can see. */
export const DEMO_PASSWORDS = {
  superAdmin: 'SuperAdmin@123',
  admin: 'Admin@123',
  salesRep: 'Sales@123',
  vendor: 'Vendor@123',
  customer: 'Customer@123',
};

const PERMISSION_SETS = {
  superAdmin: ['manage_users', 'manage_sales_reps', 'manage_vendors', 'manage_admins', 'view_reports', 'manage_billing', 'view_billing', 'manage_leads', 'manage_packages'],
  admin: ['manage_users', 'manage_leads', 'manage_packages', 'view_reports', 'manage_billing', 'view_billing'],
  salesRep: ['manage_leads', 'view_billing', 'view_reports'],
};

export async function seed(ctx) {
  const { db, ids, now, log, agency } = ctx;
  const tenantId = requireTenantId();

  /** Staff and vendors work for the agency being seeded; existing memberships are left as they are. */
  async function ensureMembership(userId, role, permissions) {
    await db.users.membership.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      update: {},
      create: { userId, role, permissions, isOwner: role === 'superAdmin', status: 'active', joinedAt: now },
    });
  }
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('users');

  // ── Passwords: hash once per role, reuse for every account with that role ──
  const hash = {};
  for (const [role, plain] of Object.entries(DEMO_PASSWORDS)) {
    hash[role] = await bcrypt.hash(plain, 12);
  }

  // Create-or-reuse. Several vendor addresses (saman@ceylonhotels.lk,
  // pradeep@islandtransport.lk, mei.lin@asiaguides.com) already exist as users
  // from the original seed, and `email` is unique — so a blind upsert-by-id
  // minted a fresh id and then collided. Look the address up first and adopt
  // the existing account rather than writing a duplicate person.
  const existingByEmail = new Map(
    (await db.users.user.findMany({ select: { id: true, email: true, role: true } })).map((u) => [u.email, u]),
  );

  const takenIds = new Set(
    (await db.users.user.findMany({ select: { id: true } })).map((u) => u.id),
  );

  /**
   * A user's id is derived from its slot in the fixture list, never from a
   * running counter. That matters: with a counter, whether a given fixture got
   * id 41 or 42 depended on how many *earlier* accounts happened to be adopted
   * by email rather than created — so the same run against a slightly different
   * database produced different ids, and the next run then collided with the
   * rows the previous one had already written.
   */
  async function ensureUser(data, slot) {
    const existing = existingByEmail.get(data.email);
    if (existing) {
      // Adopt the account as-is. Overwriting a real person's role, password or
      // permissions because a fixture happens to share their address would be
      // the seed quietly rewriting the database.
      return existing.id;
    }
    let id = idFor('user', slot);
    // Only reachable if something outside this script wrote a row in our id
    // range; probe upward rather than fail the whole run.
    for (let probe = 1; takenIds.has(id); probe += 1) id = idFor('user', slot + probe * 100000);
    await db.users.user.create({ data: { ...data, id } });
    takenIds.add(id);
    existingByEmail.set(data.email, { id, email: data.email, role: data.role });
    return id;
  }

  // ── Staff ─────────────────────────────────────────────────────────────────
  for (let i = 0; i < STAFF.length; i += 1) {
    const s = STAFF[i];
    s.id = await ensureUser({
      name: s.name,
      email: agencyEmail(s.email, agency),
      password: hash[s.role],
      role: s.role,
      isSuperAdmin: s.role === 'superAdmin',
      canBeDeleted: s.role !== 'superAdmin',
      permissions: s.permissions ?? PERMISSION_SETS[s.role] ?? [],
      isActive: true,
      isEmailVerified: true,
      passwordChangedAt: now,
      lastLogin: new Date(now.getTime() - rng.int(1, 72) * 3600 * 1000),
      lastActivity: new Date(now.getTime() - rng.int(1, 48) * 3600 * 1000),
      phoneCountry: 'LK',
    }, 1000 + i);
    await ensureMembership(s.id, s.role, s.permissions ?? PERMISSION_SETS[s.role] ?? []);
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  for (let i = 0; i < CUSTOMERS.length; i += 1) {
    const c = CUSTOMERS[i];
    c.id = await ensureUser({
      name: c.name,
      email: c.email,
      phone: c.phone,
      phoneCountry: phoneCountry(c.phone),
      password: hash.customer,
      role: 'customer',
      permissions: [],
      isActive: true,
      isEmailVerified: true,
      lastLogin: new Date(now.getTime() - rng.int(1, 240) * 3600 * 1000),
      lastActivity: new Date(now.getTime() - rng.int(1, 120) * 3600 * 1000),
    }, 2000 + i);
  }

  // ── Vendors ───────────────────────────────────────────────────────────────
  for (let i = 0; i < VENDORS.length; i += 1) {
    const v = VENDORS[i];
    const userId = await ensureUser({
      name: v.name,
      email: agencyEmail(v.email, agency),
      phone: v.phone,
      phoneCountry: phoneCountry(v.phone),
      password: hash.vendor,
      role: 'vendor',
      permissions: [],
      isActive: true,
      isEmailVerified: true,
      lastLogin: new Date(now.getTime() - rng.int(2, 300) * 3600 * 1000),
      lastActivity: new Date(now.getTime() - rng.int(2, 200) * 3600 * 1000),
    }, 3000 + i);
    v.id = userId;
    await ensureMembership(userId, 'vendor', []);

    const profileData = {
      userId,
      businessName: v.business,
      serviceType: v.type,
      businessRegistrationNumber: v.reg,
      taxIdentificationNumber: `${v.reg.replace(/\D/g, '')}-VAT`,
      addressStreet: `${rng.int(10, 250)} ${v.city} Main Road`,
      addressCity: v.city,
      addressState: null,
      addressZipCode: String(rng.int(10000, 99999)),
      addressCountry: v.country,
      contactPersonName: v.name,
      contactPersonPhone: v.phone,
      contactPersonEmail: agencyEmail(v.email, agency),
      contactPersonDesignation: 'Managing Director',
      bankAccountName: v.business.toUpperCase(),
      bankAccountNumber: String(rng.int(1000000000, 9999999999)),
      bankName: 'Commercial Bank of Ceylon PLC',
      bankBranchName: `${v.city} Branch`,
      bankIfscCode: 'CCEYLKLX',
      bankSwiftCode: 'CCEYLKLXXXX',
      rating: v.rating,
      totalBookings: v.bookings,
      vendorStatus: 'verified',
    };
    // VendorProfile.userId is unique, so create-or-update on the userId rather
    // than on a fresh id that would collide with the existing profile.
    const existingProfile = await db.users.vendorProfile.findUnique({ where: { userId } });
    if (existingProfile) {
      await db.users.vendorProfile.update({ where: { userId }, data: profileData });
    } else {
      await db.users.vendorProfile.create({ data: { id: ids.next('vendorProfile'), ...profileData } });
    }
  }

  // ── Organisation settings (singleton — updated in place, never duplicated) ─
  const orgData = {
    ...AGENCY,
    ...(!agency.isDemo && { companyName: agency.name, companyShortName: agency.name, companyLegalName: `${agency.name} (Pvt) Ltd` }),
    defaultTaxRate: AGENCY.defaultTaxRate,
    defaultServiceChargeRate: AGENCY.defaultServiceChargeRate,
    updatedById: STAFF[1].id,
  };
  const existingOrg = await db.users.organizationSettings.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existingOrg) {
    await db.users.organizationSettings.update({ where: { id: existingOrg.id }, data: orgData });
  } else {
    await db.users.organizationSettings.create({ data: { id: ids.next('orgSettings'), ...orgData } });
  }

  // ── Policy documents (unique by title; updated in place when already there)
  for (const doc of POLICY_DOCUMENTS) {
    const existing = await db.users.policyDocument.findFirst({ where: { title: doc.title } });
    if (existing) {
      await db.users.policyDocument.update({ where: { id: existing.id }, data: { body: doc.body, updatedById: STAFF[1].id } });
    } else {
      await db.users.policyDocument.create({ data: { id: ids.next('policyDoc'), ...doc, updatedById: STAFF[1].id } });
    }
  }

  // ── Read everything back so later steps can assign against real people ────
  const all = await db.users.user.findMany({
    where: {
      isActive: true,
      OR: [{ role: 'customer' }, { memberships: { some: { tenantId, status: 'active' } } }],
    },
    select: { id: true, name: true, email: true, role: true, phone: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const byRole = (role) => all.filter((u) => u.role === role);
  const reps = byRole('salesRep');
  const admins = [...byRole('admin'), ...byRole('superAdmin')];
  const customers = byRole('customer');
  const vendors = byRole('vendor');

  log(`    users: ${all.length} active (${reps.length} reps, ${admins.length} admins, ${customers.length} customers, ${vendors.length} vendors)`);

  return {
    summary: `${all.length} users · ${reps.length} reps · ${POLICY_DOCUMENTS.length} policies`,
    all,
    staff: [...admins, ...reps],
    admins,
    reps,
    customers,
    vendors,
    demo: { staff: STAFF, customers: CUSTOMERS, vendors: VENDORS },
  };
}

/** 'l' + 8 digits → 'LK' style, good enough for a phoneCountry column. */
function phoneCountry(phone = '') {
  const m = /^\+(\d{1,3})/.exec(phone);
  if (!m) return 'US';
  const code = m[1];
  const map = { 94: 'LK', 44: 'GB', 49: 'DE', 33: 'FR', 31: 'NL', 39: 'IT', 34: 'ES', 46: 'SE', 47: 'NO', 353: 'IE', 91: 'IN', 971: 'AE', 966: 'SA', 86: 'CN', 81: 'JP', 82: 'KR', 61: 'AU', 64: 'NZ', 1: 'US', 254: 'KE', 41: 'CH', 65: 'SG', 60: 'MY', 977: 'NP', 960: 'MV', 20: 'EG', 212: 'MA', 90: 'TR', 66: 'TH', 62: 'ID', 84: 'VN', 975: 'BT' };
  return map[code] ?? 'US';
}
