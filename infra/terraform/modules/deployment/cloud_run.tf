# One Cloud Run service per Services/* directory, via the reusable
# cloud-run-service sub-module. Image references compose against the single
# shared Artifact Registry repo: <region>-docker.pkg.dev/<project>/travel-crm/
# <service>:<env>-<image_tag> (the CI build-and-push job tags exactly this).
#
# NOTE — explicit module blocks instead of `for_each = local.services`:
# the *_SERVICE_URL wiring requires referencing sibling services' `.uri`
# outputs from within the module's own arguments. With a for_each module,
# a dynamically-keyed reference to module.services[...] resolves to the whole
# module expansion (Terraform cannot statically know which instance is meant),
# which includes the referencing instance itself — an unavoidable dependency
# cycle. Literal per-service module addresses keep the graph acyclic: the
# only peer references are gateway -> all backends, billing -> user/lead/
# notification, package -> user, lead -> notification/package, voice ->
# lead/billing/user/package/notification, and auth -> notification
# (notification's lead URL comes from
# var.notification_lead_service_url, lead's billing URL comes from
# var.lead_billing_service_url; two cycle-breaker variables total).
#
# local.services remains the single source of truth for name/memory/cpu/
# secrets/plain_env/allow_unauthenticated and drives the service accounts
# (iam.tf).

locals {
  secret_env_names = {
    for id in distinct(flatten([for svc in local.services : svc.secrets])) :
    id => upper(replace(trimprefix(id, "${var.env}-"), "-", "_"))
  }
}

module "gateway" {
  source = "./modules/cloud-run-service"

  name                  = local.services.gateway.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/gateway:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["gateway"].email
  secrets = [
    for id in local.services.gateway.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env = merge(local.services.gateway.plain_env, {
    AUTH_SERVICE_URL         = module.auth_service.uri
    USER_SERVICE_URL         = module.user_service.uri
    PACKAGE_SERVICE_URL      = module.package_service.uri
    LEAD_SERVICE_URL         = module.lead_service.uri
    BOOKING_SERVICE_URL      = module.booking_service.uri
    BILLING_SERVICE_URL      = module.billing_service.uri
    FLIGHT_SERVICE_URL       = module.flight_service.uri
    CAREER_SERVICE_URL       = module.career_service.uri
    NOTIFICATION_SERVICE_URL = module.notification_service.uri
    ANALYTICS_SERVICE_URL    = module.analytics_service.uri
    ASSISTANT_SERVICE_URL    = module.assistant_service.uri
    VOICE_SERVICE_URL        = module.voice_service.uri
  })
  memory                = local.services.gateway.memory
  cpu                   = local.services.gateway.cpu
  allow_unauthenticated = local.services.gateway.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug

  # Cloud Run validates secret access when the revision is created, so the
  # secret versions AND the per-service secretAccessor grants must exist first.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "auth_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.auth-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/auth-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["auth-service"].email
  secrets = [
    for id in local.services.auth-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env = merge(local.services.auth-service.plain_env, {
    NOTIFICATION_SERVICE_URL = module.notification_service.uri
  })
  memory                = local.services.auth-service.memory
  cpu                   = local.services.auth-service.cpu
  allow_unauthenticated = local.services.auth-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "user_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.user-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/user-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["user-service"].email
  secrets = [
    for id in local.services.user-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env             = local.services.user-service.plain_env
  memory                = local.services.user-service.memory
  cpu                   = local.services.user-service.cpu
  allow_unauthenticated = local.services.user-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "package_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.package-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/package-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["package-service"].email
  secrets = [
    for id in local.services.package-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env = merge(local.services.package-service.plain_env, {
    USER_SERVICE_URL = module.user_service.uri
  })
  memory                = local.services.package-service.memory
  cpu                   = local.services.package-service.cpu
  allow_unauthenticated = local.services.package-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "lead_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.lead-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/lead-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["lead-service"].email
  secrets = [
    for id in local.services.lead-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env = merge(local.services.lead-service.plain_env, {
    NOTIFICATION_SERVICE_URL = module.notification_service.uri
    PACKAGE_SERVICE_URL      = module.package_service.uri
    BILLING_SERVICE_URL      = var.lead_billing_service_url
  })
  memory                = local.services.lead-service.memory
  cpu                   = local.services.lead-service.cpu
  allow_unauthenticated = local.services.lead-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "booking_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.booking-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/booking-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["booking-service"].email
  secrets = [
    for id in local.services.booking-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env = merge(local.services.booking-service.plain_env, {
    NOTIFICATION_SERVICE_URL = module.notification_service.uri
  })
  memory                = local.services.booking-service.memory
  cpu                   = local.services.booking-service.cpu
  allow_unauthenticated = local.services.booking-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "billing_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.billing-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/billing-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["billing-service"].email
  secrets = [
    for id in local.services.billing-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env = merge(local.services.billing-service.plain_env, {
    USER_SERVICE_URL         = module.user_service.uri
    LEAD_SERVICE_URL         = module.lead_service.uri
    NOTIFICATION_SERVICE_URL = module.notification_service.uri
  })
  memory                = local.services.billing-service.memory
  cpu                   = local.services.billing-service.cpu
  allow_unauthenticated = local.services.billing-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "career_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.career-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/career-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["career-service"].email
  secrets = [
    for id in local.services.career-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env             = local.services.career-service.plain_env
  memory                = local.services.career-service.memory
  cpu                   = local.services.career-service.cpu
  allow_unauthenticated = local.services.career-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "flight_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.flight-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/flight-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["flight-service"].email
  secrets = [
    for id in local.services.flight-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env             = local.services.flight-service.plain_env
  memory                = local.services.flight-service.memory
  cpu                   = local.services.flight-service.cpu
  allow_unauthenticated = local.services.flight-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "analytics_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.analytics-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/analytics-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["analytics-service"].email
  secrets = [
    for id in local.services.analytics-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env             = local.services.analytics-service.plain_env
  memory                = local.services.analytics-service.memory
  cpu                   = local.services.analytics-service.cpu
  allow_unauthenticated = local.services.analytics-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "assistant_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.assistant-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/assistant-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["assistant-service"].email
  secrets = [
    for id in local.services.assistant-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env = merge(local.services.assistant-service.plain_env, {
    # Every URL here needs a matching run.invoker grant in iam.tf. A URL without
    # a grant is worse than a missing URL: the fetch fails at the Cloud Run edge
    # rather than falling back, so the source reports unavailable on every load.
    USER_SERVICE_URL = module.user_service.uri
    # The leads adapter (and the ask-mode lead tool) fetch the record straight
    # from lead-service. Without this they fall back to http://localhost:3004
    # inside the container, so every briefing reported the source as
    # unavailable and rendered zero insights.
    LEAD_SERVICE_URL      = module.lead_service.uri
    BILLING_SERVICE_URL   = module.billing_service.uri
    ANALYTICS_SERVICE_URL = module.analytics_service.uri
    PACKAGE_SERVICE_URL   = module.package_service.uri
    FLIGHT_SERVICE_URL    = module.flight_service.uri
    CAREER_SERVICE_URL    = module.career_service.uri
    # The public assistant can take a booking request in the chat and submit it
    # here. A URL without the matching run.invoker grant (iam.tf) is worse than
    # no URL at all — the fetch fails at the Cloud Run edge instead of falling
    # back, so the visitor is told the booking could not be sent.
    BOOKING_SERVICE_URL = module.booking_service.uri
  })
  memory                = local.services.assistant-service.memory
  cpu                   = local.services.assistant-service.cpu
  allow_unauthenticated = local.services.assistant-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

module "notification_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.notification-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/notification-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["notification-service"].email
  secrets = [
    for id in local.services.notification-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  # LEAD_SERVICE_URL already in local.services.notification-service.plain_env
  # (= var.notification_lead_service_url, the cycle-breaker).
  plain_env             = local.services.notification-service.plain_env
  memory                = local.services.notification-service.memory
  cpu                   = local.services.notification-service.cpu
  allow_unauthenticated = local.services.notification-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}
module "voice_service" {
  source = "./modules/cloud-run-service"

  name                  = local.services.voice-service.name
  project_id            = var.project_id
  region                = var.region
  image                 = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/voice-service:${var.env}-${var.image_tag}"
  service_account_email = google_service_account.services["voice-service"].email
  secrets = [
    for id in local.services.voice-service.secrets : {
      secret_id = id
      env_var   = local.secret_env_names[id]
    }
  ]
  plain_env = merge(local.services.voice-service.plain_env, {
    # Every URL here needs a matching run.invoker grant in iam.tf. Cloud Run
    # rejects an ungranted call at the platform edge, so a missing grant reads
    # inside a live call as "that tool failed", not as a fallback.
    LEAD_SERVICE_URL         = module.lead_service.uri
    BILLING_SERVICE_URL      = module.billing_service.uri
    USER_SERVICE_URL         = module.user_service.uri
    PACKAGE_SERVICE_URL      = module.package_service.uri
    NOTIFICATION_SERVICE_URL = module.notification_service.uri
  })
  memory                = local.services.voice-service.memory
  cpu                   = local.services.voice-service.cpu
  allow_unauthenticated = local.services.voice-service.allow_unauthenticated
  min_instances         = 0
  max_instances         = 10
  env                   = var.env
  company_slug          = var.company_slug
  # Cloud Run validates secret access when the revision is created, so the
  # per-service secretAccessor grants must exist first, not just the secrets.
  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}
