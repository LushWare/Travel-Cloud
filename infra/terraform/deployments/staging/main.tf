module "deployment" {
  source = "../../modules/deployment"

  env          = var.env
  company_slug = var.company_slug
  project_id   = var.project_id
  region       = var.region
  image_tag    = var.image_tag

  # Cycle-breaker for notification-service's LEAD_SERVICE_URL — this
  # environment's lead-service Cloud Run URL (fill in after the first apply).
  notification_lead_service_url = var.notification_lead_service_url
  # Cycle-breaker for lead-service's BILLING_SERVICE_URL — this
  # environment's billing-service Cloud Run URL (fill in after the first apply).
  lead_billing_service_url = var.lead_billing_service_url

  # Plain company-specific config
  cloudinary_cloud_name        = var.cloudinary_cloud_name
  email_from                   = var.email_from
  whatsapp_phone_number_id     = var.whatsapp_phone_number_id
  whatsapp_business_account_id = var.whatsapp_business_account_id

  # Secret Manager secrets (27 rows of the plan table)
  database_url               = var.database_url
  direct_url                 = var.direct_url
  jwt_secret                 = var.jwt_secret
  internal_service_key       = var.internal_service_key
  internal_events_token      = var.internal_events_token
  cloudinary_api_key         = var.cloudinary_api_key
  cloudinary_api_secret      = var.cloudinary_api_secret
  gemini_api_key             = var.gemini_api_key
  email_user                 = var.email_user
  email_password             = var.email_password
  whatsapp_access_token      = var.whatsapp_access_token
  whatsapp_app_secret        = var.whatsapp_app_secret
  whatsapp_verify_token      = var.whatsapp_verify_token
  facebook_verify_token      = var.facebook_verify_token
  facebook_app_secret        = var.facebook_app_secret
  facebook_page_access_token = var.facebook_page_access_token
  google_ads_webhook_key     = var.google_ads_webhook_key
  duffel_access_token        = var.duffel_access_token
  travelport_client_id       = var.travelport_client_id
  travelport_client_secret   = var.travelport_client_secret
  travelport_token_url       = var.travelport_token_url
  travelport_api_base_url    = var.travelport_api_base_url
  travelport_access_group    = var.travelport_access_group

  # LiteAPI hotel-search key
  liteapi_api_key = var.liteapi_api_key

  # Legacy Retell secrets are retained during migration; ElevenLabs secrets
  # below are the active voice-service credentials.
  retell_webhook_secret = var.retell_webhook_secret
  retell_tool_secret    = var.retell_tool_secret
  elevenlabs_api_key           = var.elevenlabs_api_key
  elevenlabs_webhook_secret    = var.elevenlabs_webhook_secret
  elevenlabs_initiation_secret = var.elevenlabs_initiation_secret
  elevenlabs_tool_secret       = var.elevenlabs_tool_secret

  # Branding / invoice / bank / admin-email plain config
  company_name                  = var.company_name
  company_short_name            = var.company_short_name
  company_legal_name            = var.company_legal_name
  company_tagline                = var.company_tagline
  company_logo                   = var.company_logo
  company_address                = var.company_address
  company_gst_number             = var.company_gst_number
  company_email                  = var.company_email
  sales_email                    = var.sales_email
  company_phone                  = var.company_phone
  company_whatsapp               = var.company_whatsapp
  company_website                = var.company_website
  quotation_rating_tagline       = var.quotation_rating_tagline
  brand_ink                      = var.brand_ink
  brand_muted                    = var.brand_muted
  brand_accent                   = var.brand_accent
  brand_accent_dark              = var.brand_accent_dark
  quotation_default_terms        = var.quotation_default_terms
  quotation_cancellation_policy  = var.quotation_cancellation_policy
  invoice_payment_terms          = var.invoice_payment_terms
  invoice_payment_instructions   = var.invoice_payment_instructions
  bank_name                      = var.bank_name
  bank_account_name              = var.bank_account_name
  bank_account_number            = var.bank_account_number
  bank_ifsc_code                 = var.bank_ifsc_code
  bank_swift_code                = var.bank_swift_code
  bank_branch                    = var.bank_branch
  bank_account_type              = var.bank_account_type
  upi_id                         = var.upi_id
  whatsapp_template_language     = var.whatsapp_template_language
  whatsapp_template_quotation    = var.whatsapp_template_quotation
  whatsapp_template_invoice      = var.whatsapp_template_invoice
  whatsapp_template_receipt      = var.whatsapp_template_receipt
  whatsapp_template_voucher      = var.whatsapp_template_voucher
  admin_emails                   = var.admin_emails
}
