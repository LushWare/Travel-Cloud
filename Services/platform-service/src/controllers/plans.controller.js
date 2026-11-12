import { z } from 'zod';
import { normalizePlanEntitlements, resolveEntitlements } from '../../../shared/tenancy/src/entitlements.js';
import * as planDb from '../db/plans.js';
import * as agencyDb from '../db/agencies.js';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';

const idSchema = z.object({ id: z.string().uuid() }).strict();
const keySchema = z.object({ key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/) }).strict();
const reasonSchema = z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(500);
const planSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  priceMinorUnits: z.number().int().min(0).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  billingInterval: z.enum(['monthly', 'annual']).nullable().optional(),
  entitlements: z.unknown(),
}).strict();
const createSchema = planSchema.extend({ key: keySchema.shape.key }).strict();
const duplicateSchema = z.object({ key: keySchema.shape.key, name: z.string().trim().min(1).max(120) }).strict();
const assignSchema = z.object({
  planVersionId: z.string().uuid(),
  priceMinorUnits: z.number().int().min(0).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  reason: reasonSchema,
}).strict();
const overrideSchema = z.object({ value: z.union([z.number().int().min(0), z.boolean()]), reason: reasonSchema }).strict();
const removeOverrideSchema = z.object({ reason: reasonSchema }).strict();
const parse = (schema, value) => {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Check the details and try again.', 400);
  return parsed.data;
};

async function createPlanOrConflict(input, req) {
  try {
    return await planDb.createPlan(input, req);
  } catch (err) {
    if (err.code === '23505') throw new AppError('A plan already uses that key.', 409);
    throw err;
  }
}

function normalizedVersionInput(input) {
  try {
    return {
      ...input,
      description: input.description ?? null,
      priceMinorUnits: input.priceMinorUnits ?? null,
      billingInterval: input.billingInterval ?? null,
      entitlements: normalizePlanEntitlements(input.entitlements),
    };
  } catch (err) {
    throw new AppError(err.message, 400);
  }
}

const versionInput = (body) => normalizedVersionInput(parse(planSchema, body));

async function loadAgency(id) {
  const { id: tenantId } = parse(idSchema, { id });
  const agency = await agencyDb.findAgency(tenantId);
  if (!agency) throw new AppError("We couldn't find that agency.", 404);
  if (['pending_deletion', 'deleted'].includes(agency.status)) throw new AppError('This agency cannot have plan changes.', 409);
  return agency;
}

export const listPlans = asyncHandler(async (_req, res) => {
  res.json({ status: 'success', data: await planDb.listPlans() });
});

export const createPlan = asyncHandler(async (req, res) => {
  const { key, ...input } = parse(createSchema, req.body);
  const created = await createPlanOrConflict({ key, ...normalizedVersionInput(input) }, req);
  res.status(201).json({ status: 'success', data: created });
});

export const createPlanVersion = asyncHandler(async (req, res) => {
  const { id } = parse(idSchema, req.params);
  const version = await planDb.createPlanVersion(id, versionInput(req.body), req);
  if (!version) throw new AppError("We couldn't find an active plan to update.", 404);
  res.status(201).json({ status: 'success', data: version });
});

export const duplicatePlan = asyncHandler(async (req, res) => {
  const { id } = parse(idSchema, req.params);
  const { key, name } = parse(duplicateSchema, req.body);
  const source = await planDb.findPlanVersion(id, { currentOnly: true });
  if (!source || source.archivedAt) throw new AppError("We couldn't find an active plan to duplicate.", 404);
  const created = await createPlanOrConflict({
    key,
    name,
    description: source.description,
    priceMinorUnits: source.priceMinorUnits,
    currency: source.currency,
    billingInterval: source.billingInterval,
    entitlements: normalizePlanEntitlements(source.entitlements),
  }, req);
  res.status(201).json({ status: 'success', data: created });
});

export const archivePlan = asyncHandler(async (req, res) => {
  const { id } = parse(idSchema, req.params);
  if (!await planDb.findPlan(id)) throw new AppError("We couldn't find that plan.", 404);
  if (!await planDb.archivePlan(id, req)) throw new AppError('This plan is already archived.', 409);
  res.json({ status: 'success', data: { id, archived: true } });
});

export const getAgencyPlan = asyncHandler(async (req, res) => {
  const agency = await loadAgency(req.params.id);
  const plan = await planDb.getAgencyPlan(agency.id);
  const resolved = resolveEntitlements({
    planVersion: plan.assignment ? {
      id: plan.assignment.planVersionId, planId: plan.assignment.planId, version: plan.assignment.version,
      name: plan.assignment.name, description: plan.assignment.description,
      priceMinorUnits: plan.assignment.priceMinorUnits, currency: plan.assignment.currency,
      billingInterval: plan.assignment.billingInterval, entitlements: plan.assignment.entitlements,
      plan: { id: plan.assignment.planId, key: plan.assignment.key },
    } : null,
    overrides: plan.overrides,
  });
  res.json({ status: 'success', data: { ...plan, resolved } });
});

export const assignAgencyPlan = asyncHandler(async (req, res) => {
  const agency = await loadAgency(req.params.id);
  const input = parse(assignSchema, req.body);
  const assignment = await planDb.assignAgencyPlan(agency.id, input.planVersionId, input, input.reason, req);
  if (!assignment) throw new AppError('Choose a version from an active plan.', 404);
  res.json({ status: 'success', data: assignment });
});

export const setAgencyOverride = asyncHandler(async (req, res) => {
  const agency = await loadAgency(req.params.id);
  const { key } = parse(z.object({ key: z.string().min(1).max(64) }).strict(), { key: req.params.key });
  const input = parse(overrideSchema, req.body);
  try {
    resolveEntitlements({ overrides: [{ entitlementKey: key, value: input.value }] });
  } catch (err) {
    throw new AppError(err.message, 400);
  }
  const override = await planDb.setAgencyOverride(agency.id, key, input.value, input.reason, req);
  res.json({ status: 'success', data: override });
});

export const removeAgencyOverride = asyncHandler(async (req, res) => {
  const agency = await loadAgency(req.params.id);
  const { key } = parse(z.object({ key: z.string().min(1).max(64) }).strict(), { key: req.params.key });
  const { reason } = parse(removeOverrideSchema, req.body);
  try {
    resolveEntitlements({ overrides: [{ entitlementKey: key, value: key.startsWith('features.') ? true : 0 }] });
  } catch (err) {
    throw new AppError(err.message, 400);
  }
  if (!await planDb.removeAgencyOverride(agency.id, key, reason, req)) throw new AppError('This agency has no such override.', 404);
  res.json({ status: 'success', data: { removed: true } });
});