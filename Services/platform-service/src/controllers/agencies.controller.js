import { z } from 'zod';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import * as agencies from '../db/agencies.js';
import * as planDb from '../db/plans.js';
import { resolveEntitlements } from '../../../shared/tenancy/src/entitlements.js';
import { startHelpAccess } from '../db/help.js';
import { hashToken, newSessionToken } from '../security/tokens.js';

// The one-time link that opens the help session must be used within this time.
const HANDOFF_SECONDS = 120;

// The agency that serves the public website; suspending it would take the website down.
const PUBLIC_SITE_TENANT_ID = () => process.env.PUBLIC_SITE_TENANT_ID || '00000000-0000-4000-8000-000000000001';
const STATUSES = ['trial', 'active', 'past_due', 'suspended', 'pending_deletion', 'deleted'];
const RESTORABLE = new Set(['trial', 'active', 'past_due']);

const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  sort: z.enum(Object.keys(agencies.SORTS)).default('name'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

const idSchema = z.object({ id: z.string().uuid() }).strict();

const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(500),
}).strict();

const helpSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(500),
  minutes: z.union([z.literal(15), z.literal(30)]),
}).strict();

const parse = (schema, value) => {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Check the details and try again.', 400);
  return parsed.data;
};

async function loadAgency(req) {
  const { id } = parse(idSchema, req.params);
  const agency = await agencies.findAgency(id);
  if (!agency) throw new AppError("We couldn't find that agency.", 404);
  return agency;
}

const auditOf = (req, action, summary, details) => ({
  actorId: req.platformUser.id,
  actorEmail: req.platformUser.email,
  actorRole: `platform:${req.platformUser.role}`.slice(0, 32),
  action, summary: summary.slice(0, 300), details,
  ipAddress: req.headers['x-client-ip'] ?? req.ip ?? null,
  requestId: req.requestId ?? null,
});

export const listAgencies = asyncHandler(async (req, res) => {
  const { search, status, sort, page, limit } = parse(listSchema, req.query);
  const { rows, total } = await agencies.listAgencies({ search: search || undefined, status, sort, limit, offset: (page - 1) * limit });
  res.json({ status: 'success', data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const getAgency = asyncHandler(async (req, res) => {
  const agency = await loadAgency(req);
  const [detail, history, plan] = await Promise.all([
    agencies.agencyDetail(agency.id), agencies.agencyHistory(agency.id), planDb.getAgencyPlan(agency.id),
  ]);
  const resolvedPlan = resolveEntitlements({
    planVersion: plan.assignment ? {
      id: plan.assignment.planVersionId, planId: plan.assignment.planId, version: plan.assignment.version,
      name: plan.assignment.name, description: plan.assignment.description,
      priceMinorUnits: plan.assignment.priceMinorUnits, currency: plan.assignment.currency,
      billingInterval: plan.assignment.billingInterval, entitlements: plan.assignment.entitlements,
      plan: { id: plan.assignment.planId, key: plan.assignment.key },
    } : null,
    overrides: plan.overrides,
  });
  res.json({ status: 'success', data: { agency, ...detail, history, plan: { ...plan, resolved: resolvedPlan }, isPublicSite: agency.id === PUBLIC_SITE_TENANT_ID() } });
});

export const suspendAgency = asyncHandler(async (req, res) => {
  const agency = await loadAgency(req);
  const { reason } = parse(reasonSchema, req.body);
  if (agency.id === PUBLIC_SITE_TENANT_ID()) {
    throw new AppError('This agency runs the public website and cannot be suspended.', 409);
  }
  if (!RESTORABLE.has(agency.status)) throw new AppError(`This agency is ${agency.status.replace('_', ' ')} and cannot be suspended.`, 409);

  const changed = await agencies.setAgencyStatus(agency.id, {
    status: 'suspended', expectedStatus: agency.status, revokeSessions: true,
    audit: auditOf(req, 'platform.agency_suspended', `Lushware suspended ${agency.name}: ${reason}`, { previousStatus: agency.status, reason }),
  });
  if (!changed) throw new AppError('This agency changed while you were looking at it. Refresh and try again.', 409);
  res.json({ status: 'success', data: { agency: { ...agency, status: 'suspended' } } });
});

/**
 * Opens view-only help access to an agency. Returns a one-time code, good for two minutes, that the
 * console exchanges (through auth-service) for a Management session in that agency.
 */
export const startHelp = asyncHandler(async (req, res) => {
  const agency = await loadAgency(req);
  const { reason, minutes } = parse(helpSchema, req.body);
  if (['pending_deletion', 'deleted'].includes(agency.status)) {
    throw new AppError('This agency is being deleted and cannot be opened.', 409);
  }

  const code = newSessionToken();
  const grant = await startHelpAccess({
    platformUser: req.platformUser, tenantId: agency.id, reason, minutes,
    handoffCodeHash: hashToken(code), handoffSeconds: HANDOFF_SECONDS,
    audit: {
      summary: `Lushware staff ${req.platformUser.email} opened view-only help access for ${minutes} minutes: ${reason}`,
      ipAddress: req.headers['x-client-ip'] ?? req.ip ?? null,
      requestId: req.requestId ?? null,
    },
  });
  res.status(201).json({ status: 'success', data: { grantId: grant.id, expiresAt: grant.expiresAt, code } });
});

export const restoreAgency = asyncHandler(async (req, res) => {
  const agency = await loadAgency(req);
  const { reason } = parse(reasonSchema, req.body);
  if (agency.status !== 'suspended') throw new AppError('Only a suspended agency can be restored.', 409);

  const previous = await agencies.statusBeforeSuspension(agency.id);
  const status = RESTORABLE.has(previous) ? previous : 'active';
  const changed = await agencies.setAgencyStatus(agency.id, {
    status, expectedStatus: 'suspended', revokeSessions: false,
    audit: auditOf(req, 'platform.agency_restored', `Lushware restored ${agency.name}: ${reason}`, { restoredStatus: status, reason }),
  });
  if (!changed) throw new AppError('This agency changed while you were looking at it. Refresh and try again.', 409);
  res.json({ status: 'success', data: { agency: { ...agency, status } } });
});
