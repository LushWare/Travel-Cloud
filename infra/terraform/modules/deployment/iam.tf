# One Cloud Run service account per service. account_id is the env-prefixed
# service name ("<env>-<service>"), e.g. staging-notification-service (28
# chars, under GCP's 30-char service-account-id limit). google_service_account
# does not support labels, so company/env attribution lives in display_name.
resource "google_service_account" "services" {
  for_each = local.services

  project      = var.project_id
  account_id   = each.value.name
  display_name = "Cloud Run service account for ${each.value.name} (company: ${var.company_slug})"
}

# Scoped secretAccessor grants: each service account may read ONLY the
# env-prefixed secrets its own service consumes (local.services[<svc>].secrets).
resource "google_secret_manager_secret_iam_member" "service_secrets" {
  for_each = { for b in local.service_secret_bindings : "${b.service_key}:${b.secret_id}" => b }

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.services[each.value.service_key].email}"

  # Secrets are created in secrets.tf in this same module; keep the IAM grants
  # ordered after them (secret_id here is the short env-prefixed id).
  depends_on = [google_secret_manager_secret.secrets]
}

# run.invoker on every non-gateway backend, granted ONLY to this same
# environment's gateway service account (google_service_account.services
# ["gateway"] from THIS module instantiation — never a cross-environment
# reference, so a staging backend can never be invoked by the prod gateway's
# identity or vice versa). Combined with the gateway's Google-signed ID token
# per backend call (Services/gateway/src/index.js), this closes the gap that
# public ingress on the *.run.app URLs would otherwise open.
# (Explicit resources, mirroring the explicit module blocks in cloud_run.tf —
# see the note there on why a for_each module cannot self-reference outputs.)
resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_auth" {
  project  = var.project_id
  location = var.region
  name     = module.auth_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_user" {
  project  = var.project_id
  location = var.region
  name     = module.user_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_package" {
  project  = var.project_id
  location = var.region
  name     = module.package_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_lead" {
  project  = var.project_id
  location = var.region
  name     = module.lead_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_booking" {
  project  = var.project_id
  location = var.region
  name     = module.booking_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_billing" {
  project  = var.project_id
  location = var.region
  name     = module.billing_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_career" {
  project  = var.project_id
  location = var.region
  name     = module.career_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_flight" {
  project  = var.project_id
  location = var.region
  name     = module.flight_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_analytics" {
  project  = var.project_id
  location = var.region
  name     = module.analytics_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_recommendations" {
  project  = var.project_id
  location = var.region
  name     = module.recommendation_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_assistant" {
  project  = var.project_id
  location = var.region
  name     = module.assistant_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_notification" {
  project  = var.project_id
  location = var.region
  name     = module.notification_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}
# The voice webhooks and the CustomTool endpoints both arrive through the
# gateway (`/api/v1/webhooks/voice/*`), which is the only path that authenticates
# them — Retell calls the public gateway host, never this service directly.
resource "google_cloud_run_v2_service_iam_member" "gateway_invoker_voice" {
  project  = var.project_id
  location = var.region
  name     = module.voice_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["gateway"].email}"
}

# Service-to-service invoker grants (deliberately NOT the gateway identity).
# The Management copilot reads the lead record straight from lead-service —
# no gateway hop, by design, so no public rate limiter and no server-to-self
# ingress (docs/designs/management-context-copilot.md §"Adapters"). It forwards
# the original caller's x-user-* headers, so lead-service's own ownership and
# role checks still decide access; this grant only lets the call reach the
# container at all. Cloud Run rejects an unauthenticated call at the platform
# edge with a 403 before the app runs, so the caller must also present an ID
# token for this service's URL — minted in
# Services/assistant-service/src/utils/cloudRunAuth.js.
resource "google_cloud_run_v2_service_iam_member" "assistant_invoker_lead" {
  project  = var.project_id
  location = var.region
  name     = module.lead_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["assistant-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "recommendation_invoker_analytics" {
  project  = var.project_id
  location = var.region
  name     = module.analytics_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["recommendation-service"].email}"
}

# The billing page's adapter reads invoice and quotation aggregates straight
# from billing-service under the same rules as the leads grant above: it reaches
# the container, and billing-service's own checks still decide access.
resource "google_cloud_run_v2_service_iam_member" "assistant_invoker_billing" {
  project  = var.project_id
  location = var.region
  name     = module.billing_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["assistant-service"].email}"
}

# ── Remaining page adapters ───────────────────────────────────────────────
# Every page key the copilot serves needs BOTH the internal URL on
# assistant-service (cloud_run.tf) and a run.invoker grant here. Domain services
# run with allow_unauthenticated = false, so a missing grant is not a 403 the
# app can explain — Cloud Run rejects the call at the platform edge before the
# container starts, and the page renders as "source unavailable".
#
# assistant_invoker_user is the one that matters most: USER_SERVICE_URL has been
# set on assistant-service since the public assistant shipped, but no grant was
# ever added, so that call could not have succeeded in a deployed environment.
# The settings page reads it directly, and so does the policy-document path.
#
# These are written out individually rather than as a for_each map on purpose:
# converting the existing gateway_invoker_* resources would change their state
# addresses, and rewriting live IAM bindings for tidiness is not worth the risk.
# A future change can consolidate the whole family once nothing is mid-deploy.
resource "google_cloud_run_v2_service_iam_member" "assistant_invoker_user" {
  project  = var.project_id
  location = var.region
  name     = module.user_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["assistant-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "assistant_invoker_analytics" {
  project  = var.project_id
  location = var.region
  name     = module.analytics_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["assistant-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "assistant_invoker_package" {
  project  = var.project_id
  location = var.region
  name     = module.package_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["assistant-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "assistant_invoker_flight" {
  project  = var.project_id
  location = var.region
  name     = module.flight_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["assistant-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "assistant_invoker_career" {
  project  = var.project_id
  location = var.region
  name     = module.career_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["assistant-service"].email}"
}

# The public assistant submits a booking request straight to booking-service
# when a visitor confirms one in the chat, under the same rules as the leads and
# billing grants above: it reaches the container, and booking-service's own
# validation still decides what is accepted. Without this grant the call is
# rejected at the Cloud Run edge before the app runs, which the turn reports to
# the visitor as "nothing was booked" rather than as a failure.
resource "google_cloud_run_v2_service_iam_member" "assistant_invoker_booking" {
  project  = var.project_id
  location = var.region
  name     = module.booking_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["assistant-service"].email}"
}
# ── Voice agent (voice-service) ────────────────────────────────────────────
# The agent reads and prepares state through the domain services during a call:
# caller identity and trip status from lead-service, catalog search from
# package-service, the latest sent document and the four resend routes from
# billing-service, and the sales-rep lookup from user-service. notification-service
# carries the "a rep must call this person back" email. Same rule as above — the
# URL in cloud_run.tf is inert without the grant here, and a call that cannot
# reach a service tells the caller the tool failed.
resource "google_cloud_run_v2_service_iam_member" "voice_invoker_lead" {
  project  = var.project_id
  location = var.region
  name     = module.lead_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["voice-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "voice_invoker_billing" {
  project  = var.project_id
  location = var.region
  name     = module.billing_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["voice-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "voice_invoker_user" {
  project  = var.project_id
  location = var.region
  name     = module.user_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["voice-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "voice_invoker_package" {
  project  = var.project_id
  location = var.region
  name     = module.package_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["voice-service"].email}"
}

resource "google_cloud_run_v2_service_iam_member" "voice_invoker_notification" {
  project  = var.project_id
  location = var.region
  name     = module.notification_service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.services["voice-service"].email}"
}
