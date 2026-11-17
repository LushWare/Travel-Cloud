# Scheduled work that has no request to trigger it.
#
# billing-lifecycle (hourly): ends free trials nobody paid for, emails payment
# reminders, and suspends agencies 14 days past due
# (Services/auth-service/scripts/process-subscription-lifecycle.mjs). It runs as a
# Cloud Run Job built from auth-service's image, with auth-service's service
# account, secrets and settings, so it needs no access auth-service lacks.
#
# Image: Terraform sets it once at creation, like the services; after that CI moves
# it to each new auth-service image (.github/workflows/deploy.yml), so it is
# ignored here and an unrelated apply never rolls the job back.

resource "google_project_service" "cloudscheduler" {
  project            = var.project_id
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

resource "google_cloud_run_v2_job" "billing_lifecycle" {
  name     = "${var.env}-billing-lifecycle"
  location = var.region
  project  = var.project_id

  labels = {
    company     = var.company_slug
    environment = var.env
  }

  template {
    task_count = 1

    template {
      service_account = google_service_account.services["auth-service"].email
      # Two quick attempts; the run is safe to repeat (each step only acts on what is still due).
      max_retries = 1
      timeout     = "600s"

      containers {
        image   = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/auth-service:${var.env}-${var.image_tag}"
        command = ["node"]
        args    = ["scripts/process-subscription-lifecycle.mjs"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        dynamic "env" {
          for_each = local.services.auth-service.secrets
          content {
            name = local.secret_env_names[env.value]
            value_source {
              secret_key_ref {
                secret  = "projects/${var.project_id}/secrets/${env.value}"
                version = "latest"
              }
            }
          }
        }

        dynamic "env" {
          for_each = merge(local.services.auth-service.plain_env, {
            NOTIFICATION_SERVICE_URL = module.notification_service.uri
          })
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
  ]
}

# The scheduler acts as its own account, which may only start this one job.
resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "${var.env}-scheduler"
  display_name = "Cloud Scheduler for ${var.env} scheduled jobs (company: ${var.company_slug})"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_billing_lifecycle" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.billing_lifecycle.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "billing_lifecycle_hourly" {
  project     = var.project_id
  region      = var.region
  name        = "${var.env}-billing-lifecycle-hourly"
  description = "Ends unpaid trials, sends payment reminders and suspends long-overdue agencies."
  schedule    = "5 * * * *"
  time_zone   = "Etc/UTC"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.billing_lifecycle.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_project_service.cloudscheduler,
    google_cloud_run_v2_job_iam_member.scheduler_runs_billing_lifecycle,
  ]
}

# ─── Failure alert ───────────────────────────────────────────────────────────
# Without this a broken job fails quietly every hour: trials never end and
# nobody is reminded to pay. One email per failure (at most every 6 hours).
# Created only when ops_alert_email is set.

resource "google_monitoring_notification_channel" "ops_email" {
  count        = var.ops_alert_email == "" ? 0 : 1
  project      = var.project_id
  display_name = "${var.env} operations email"
  type         = "email"
  labels = {
    email_address = var.ops_alert_email
  }
}

resource "google_monitoring_alert_policy" "billing_lifecycle_failed" {
  count        = var.ops_alert_email == "" ? 0 : 1
  project      = var.project_id
  display_name = "${var.env}: billing lifecycle job failed"
  combiner     = "OR"

  conditions {
    display_name = "billing-lifecycle logged an error"
    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_run_job"
        resource.labels.job_name="${google_cloud_run_v2_job.billing_lifecycle.name}"
        severity>=ERROR
      EOT
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "21600s"
    }
    auto_close = "86400s"
  }

  documentation {
    content   = "The hourly billing job (${google_cloud_run_v2_job.billing_lifecycle.name}) failed. Trials may not be ending and payment reminders may not be going out. Open Cloud Run > Jobs > ${google_cloud_run_v2_job.billing_lifecycle.name} > Executions to see the log."
    mime_type = "text/markdown"
  }

  notification_channels = [google_monitoring_notification_channel.ops_email[0].id]
}

# ─── Integration health (daily) ─────────────────────────────────────────────
# Checks every agency's connected email, WhatsApp, Facebook and Stripe account; marks a broken
# one 'error' and emails the owner once (Services/integration-service/scripts/check-integrations.mjs).
# Runs as integration-service's account (the only one that may decrypt connection secrets) with
# the admin database connection, because it reads every agency.

resource "google_cloud_run_v2_job" "integration_health" {
  name     = "${var.env}-integration-health"
  location = var.region
  project  = var.project_id

  labels = {
    company     = var.company_slug
    environment = var.env
  }

  template {
    task_count = 1

    template {
      service_account = google_service_account.services["integration-service"].email
      max_retries     = 1
      timeout         = "900s"

      containers {
        image   = "${var.region}-docker.pkg.dev/${var.project_id}/travel-crm/integration-service:${var.env}-${var.image_tag}"
        command = ["node"]
        args    = ["scripts/check-integrations.mjs"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        dynamic "env" {
          for_each = local.services.integration-service.secrets
          content {
            name = local.secret_env_names[env.value]
            value_source {
              secret_key_ref {
                secret  = "projects/${var.project_id}/secrets/${env.value}"
                version = "latest"
              }
            }
          }
        }

        dynamic "env" {
          for_each = merge(local.services.integration-service.plain_env, {
            NOTIFICATION_SERVICE_URL = module.notification_service.uri
            MANAGEMENT_URL           = local.management_url
          })
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_secret_manager_secret_version.secrets,
    google_secret_manager_secret_iam_member.service_secrets,
    google_kms_crypto_key_iam_member.integration_service,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_integration_health" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.integration_health.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "integration_health_daily" {
  project     = var.project_id
  region      = var.region
  name        = "${var.env}-integration-health-daily"
  description = "Checks every agency's connected accounts and emails owners about broken ones."
  schedule    = "0 6 * * *"
  time_zone   = "Etc/UTC"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.integration_health.name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_project_service.cloudscheduler,
    google_cloud_run_v2_job_iam_member.scheduler_runs_integration_health,
  ]
}

resource "google_monitoring_alert_policy" "integration_health_failed" {
  count        = var.ops_alert_email == "" ? 0 : 1
  project      = var.project_id
  display_name = "${var.env}: integration health job failed"
  combiner     = "OR"

  conditions {
    display_name = "integration-health logged an error"
    condition_matched_log {
      filter = <<-EOT
        resource.type="cloud_run_job"
        resource.labels.job_name="${google_cloud_run_v2_job.integration_health.name}"
        severity>=ERROR
      EOT
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "21600s"
    }
    auto_close = "86400s"
  }

  documentation {
    content   = "The daily integration health job (${google_cloud_run_v2_job.integration_health.name}) failed or could not email an owner. Open Cloud Run > Jobs > ${google_cloud_run_v2_job.integration_health.name} > Executions to see the log."
    mime_type = "text/markdown"
  }

  notification_channels = [google_monitoring_notification_channel.ops_email[0].id]
}
