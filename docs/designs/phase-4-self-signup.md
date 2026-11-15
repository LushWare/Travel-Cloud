# Phase 4: Self-sign-up and subscription billing

Agency owners create their account in Management at `/signup`. The Landing site remains unchanged; its hidden plans page is not part of this flow. The signup form chooses a public plan, creates the agency on a 14-day Growth trial, and retains the chosen plan for the post-trial subscription.

## Billing setup

SaaS subscriptions are separate from agency Stripe Connect invoice payments. Owner-only subscription controls are in Management under **Settings → Organization → SaaS plan and billing**. Stripe Checkout collects the payment method; Stripe's billing portal handles saved cards, invoices, and cancellation. Plan changes are sent through the subscription API and take effect after Stripe confirms the invoice payment.

Configure these auth-service environment variables:

- `STRIPE_SECRET_KEY`: secret key for the Stripe mode being used (test or live).
- `STRIPE_WEBHOOK_SECRET`: signing secret for the SaaS billing webhook endpoint.
- `MANAGEMENT_URL`: the Management origin used for Checkout return URLs and billing reminders.

Register `POST /api/v1/webhooks/stripe-billing` with Stripe and subscribe to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.payment_succeeded`

The endpoint validates Stripe's signature against the raw request body and deduplicates events by Stripe event ID. The first checkout creates a Stripe product and recurring price for that immutable plan version; these records are reused for future subscriptions.

Apply the schema before deploying auth-service:

```powershell
cd Services\user-service
npm run db:migrate:deploy
```

Do not use `prisma migrate dev` or `db:push` against the shared database.

## Payment lifecycle job

Run this command from a scheduled job at least hourly:

```powershell
cd Services\auth-service
npm run billing:lifecycle
```

The job expires trials without a subscription, sends owner reminders, and suspends agencies 14 days after a failed payment or trial expiry. Signed-in agency tokens become read-only after seven days past due; an owner can still reach billing recovery. A successful invoice clears the delinquency and restores access. Manual Console suspensions are not automatically reversed by Stripe payments.

Staff access claims are refreshed during login or token renewal. A billing status change can therefore take up to the 15-minute staff access-token lifetime to affect an already-open session.

## Launch gate

Before accepting real agencies, configure and test Stripe in its intended mode, verify the scheduled job is running, and complete an independent security assessment. This work does not perform that external assessment or apply database migrations.

## Remaining Phase 4 work

- CSV import currently creates lead records only. The CRM has no separate agency-owned customer entity, so customer import needs a product/data-model decision rather than silently converting customers into leads.
- Owner data export and the cancellable 30-day deletion flow, including verified cross-service data purge, are not implemented.
- The complete signup-to-booking Management E2E flow and the independent external security assessment remain launch gates.
