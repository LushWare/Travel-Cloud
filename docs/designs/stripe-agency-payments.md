# Stripe agency invoice payments

Each agency connects its own Stripe account through the CRM's Stripe Connect Standard OAuth flow. Checkout charges that connected account directly; the platform does not collect or store card details.

## Required configuration

Set these values in the relevant service environments:

- `integration-service`: `STRIPE_CLIENT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_API_URL`, `CLIENT_URL`, `BILLING_SERVICE_URL`, and `INTERNAL_EVENTS_TOKEN`
- `billing-service`: `INTEGRATION_SERVICE_URL` and the same `INTERNAL_EVENTS_TOKEN`
- `gateway`: `INTEGRATION_SERVICE_URL`

In Stripe Connect settings, enable Standard OAuth. Configure the live Connect app and use its live client ID and secret for production; test and live connected accounts cannot be mixed. Add a Connect webhook endpoint at:

`https://<API_DOMAIN>/api/v1/webhooks/stripe`

Subscribe to connected-account events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Store that endpoint's signing secret as `STRIPE_WEBHOOK_SECRET` in integration-service. Production `PUBLIC_API_URL` and `CLIENT_URL` must use HTTPS.

## Database and customer flow

Apply integration-service migrations with `cd Services/integration-service && npm run db:migrate:deploy`. Migration `004_stripe_payment_links.sql` stores tenant-scoped payment links and Checkout sessions; the public token is stored only as a SHA-256 hash. No billing-service schema migration is required.

When an invoice is emailed, billing-service adds a Stripe payment link if the agency account is ready. Staff can also create and copy a link from the invoice view. Customers can pay the remaining balance or enter a smaller amount. Stripe webhooks create an idempotent billing receipt and update the invoice balance; webhook reconciliation remains enabled for outstanding invoices even if the agency later downgrades its plan.

Online payments are not ready until the platform Stripe configuration, the agency's connected account with charges enabled, the webhook secret, and the integration migration are all in place.
