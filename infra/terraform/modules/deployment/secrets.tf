# Full Secret Manager table from the deployment plan. Actual secret ids are
# env-prefixed ("<env>-<logical id>") because
# Secret Manager ids are unique per project and all three environments share
# one GCP project — the second environment's apply must not collide.
locals {
  secrets = {
    database-url               = var.database_url
    direct-url                 = var.direct_url
    jwt-secret                 = var.jwt_secret
    internal-service-key       = var.internal_service_key
    internal-events-token      = var.internal_events_token
    cloudinary-api-key         = var.cloudinary_api_key
    cloudinary-api-secret      = var.cloudinary_api_secret
    gemini-api-key             = var.gemini_api_key
    email-user                 = var.email_user
    email-password             = var.email_password
    whatsapp-access-token      = var.whatsapp_access_token
    whatsapp-app-secret        = var.whatsapp_app_secret
    whatsapp-verify-token      = var.whatsapp_verify_token
    facebook-verify-token      = var.facebook_verify_token
    facebook-app-secret        = var.facebook_app_secret
    facebook-page-access-token = var.facebook_page_access_token
    google-ads-webhook-key     = var.google_ads_webhook_key
    duffel-access-token        = var.duffel_access_token
    duffel-webhook-secret      = var.duffel_webhook_secret
    travelport-client-id       = var.travelport_client_id
    travelport-client-secret   = var.travelport_client_secret
    travelport-token-url       = var.travelport_token_url
    travelport-api-base-url    = var.travelport_api_base_url
    travelport-access-group    = var.travelport_access_group
    liteapi-api-key            = var.liteapi_api_key
    retell-webhook-secret      = var.retell_webhook_secret
    retell-tool-secret         = var.retell_tool_secret
    elevenlabs-api-key             = var.elevenlabs_api_key
    elevenlabs-webhook-secret      = var.elevenlabs_webhook_secret
    elevenlabs-initiation-secret   = var.elevenlabs_initiation_secret
    elevenlabs-tool-secret         = var.elevenlabs_tool_secret
  }
}

resource "google_secret_manager_secret" "secrets" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = "${var.env}-${each.key}"
  labels = {
    company     = var.company_slug
    environment = var.env
  }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "secrets" {
  for_each = local.secrets

  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value
}
