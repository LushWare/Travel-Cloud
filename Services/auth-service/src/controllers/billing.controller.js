import { z } from 'zod';
import AppError from '../utils/appError.js';
import asyncHandler from '../utils/asyncHandler.js';
import prisma from '../db/client.js';
import {
  createBillingPortal,
  changeSubscriptionPlan,
  createSubscriptionCheckout,
  processStripeEvent,
  verifyStripeSignature,
} from '../services/stripeBilling.service.js';

const checkoutSchema = z.object({ planVersionId: z.string().uuid() }).strict();
const changePlanSchema = z.object({ planVersionId: z.string().uuid() }).strict();
const IDENTITY_HEADERS = ['x-user-id', 'x-tenant-id'];

async function requireAgencyOwner(req) {
  const [userId, tenantId] = IDENTITY_HEADERS.map((name) => req.headers[name]);
  if (!userId || !tenantId) throw new AppError('Not authorized.', 401);
  const [membership] = await prisma.$queryRaw`
    SELECT m."isOwner", m.status::text AS "membershipStatus",
           t.status::text AS "tenantStatus"
      FROM crm_users."Membership" m
      JOIN crm_platform."Tenant" t ON t.id = m."tenantId"
     WHERE m."userId" = ${userId}
       AND m."tenantId" = ${tenantId}::uuid
     LIMIT 1
  `;
  if (!membership || membership.membershipStatus !== 'active') throw new AppError('Not authorized.', 403);
  if (!membership.isOwner) throw new AppError('Only the agency owner can manage billing.', 403);
  if (['pending_deletion', 'deleted'].includes(membership.tenantStatus)) {
    throw new AppError('This agency cannot manage billing.', 409);
  }
  return { userId, tenantId, status: membership.tenantStatus };
}

export const getBillingStatus = asyncHandler(async (req, res) => {
  const { tenantId } = await requireAgencyOwner(req);
  const [status] = await prisma.$queryRaw`
    SELECT t.status::text AS status, t."trialEndsAt", t."pastDueAt",
           t."subscriptionCurrentPeriodEnd", t."cancelAtPeriodEnd",
           t."postTrialPlanVersionId", t."stripeSubscriptionId", tp."planVersionId" AS "currentPlanVersionId",
           pv.name AS "planName", pv."priceMinorUnits", pv.currency, pv."billingInterval"
      FROM crm_platform."Tenant" t
      LEFT JOIN crm_platform."TenantPlan" tp ON tp."tenantId" = t.id
      LEFT JOIN crm_platform."PlanVersion" pv ON pv.id = tp."planVersionId"
     WHERE t.id = ${tenantId}::uuid
     LIMIT 1
  `;
  res.json({
    status: 'success',
    data: {
      ...status,
      hasSubscription: Boolean(status?.stripeSubscriptionId),
    },
  });
});

export const startBillingCheckout = asyncHandler(async (req, res) => {
  const input = checkoutSchema.safeParse(req.body);
  if (!input.success) throw new AppError('Choose an available plan to continue.', 400);
  const identity = await requireAgencyOwner(req);
  try {
    const data = await createSubscriptionCheckout({
      tenantId: identity.tenantId,
      owner: { name: req.headers['x-user-name'], email: req.headers['x-user-email'] },
      planVersionId: input.data.planVersionId,
    });
    const { recoveredStaleCheckout, ...checkout } = data;
    if (recoveredStaleCheckout) {
      req.log?.warn?.(
        { tenantId: identity.tenantId, requestId: req.requestId },
        'A stale Stripe checkout session was cleared before creating a new session',
      );
    }
    res.json({ status: 'success', data: checkout });
  } catch (error) {
    req.log?.error?.({ err: error, tenantId: identity.tenantId, requestId: req.requestId }, 'Stripe checkout could not be created');
    throw new AppError('Billing checkout could not be started. Please try again.', 502);
  }
});

export const openBillingPortal = asyncHandler(async (req, res) => {
  const { tenantId } = await requireAgencyOwner(req);
  const baseUrl = process.env.MANAGEMENT_URL;
  if (!baseUrl) throw new AppError('Billing is temporarily unavailable.', 503);
  try {
    const data = await createBillingPortal({ tenantId, returnUrl: `${baseUrl}/settings` });
    res.json({ status: 'success', data });
  } catch (error) {
    req.log?.error?.({ err: error, tenantId, requestId: req.requestId }, 'Stripe billing portal could not be opened');
    throw new AppError('Billing portal could not be opened. Please try again.', 502);
  }
});

export const changeBillingPlan = asyncHandler(async (req, res) => {
  const input = changePlanSchema.safeParse(req.body);
  if (!input.success) throw new AppError('Choose an available plan to continue.', 400);
  const { tenantId } = await requireAgencyOwner(req);
  try {
    const data = await changeSubscriptionPlan({ tenantId, planVersionId: input.data.planVersionId });
    res.json({ status: 'success', data });
  } catch (error) {
    req.log?.error?.({ err: error, tenantId, requestId: req.requestId }, 'Stripe plan change could not be completed');
    throw new AppError('The plan could not be changed. Please try again.', 502);
  }
});

export const receiveStripeBillingWebhook = asyncHandler(async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new AppError('Billing webhook is not configured.', 503);
  const event = verifyStripeSignature(
    req.body,
    req.get('stripe-signature'),
    process.env.STRIPE_WEBHOOK_SECRET,
  );
  if (!event?.id || !event.type || !event.data) throw new AppError('Invalid webhook signature.', 400);
  await processStripeEvent(event);
  res.json({ received: true });
});
