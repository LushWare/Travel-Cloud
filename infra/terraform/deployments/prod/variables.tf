# Pass-through variables mirroring infra/terraform/modules/deployment/
# variables.tf (root configs must redeclare the variables they pass on).
# All values come from terraform.tfvars (gitignored); see
# terraform.tfvars.example for the placeholder template.

variable "env" {
  description = "Environment name."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be dev, staging, or prod."
  }
}

variable "company_slug" {
  description = "Company identifier used only for resource labels / cost attribution."
  type        = string
}

variable "project_id" {
  description = "GCP project ID for this company's fork."
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run and Secret Manager."
  type        = string
  default     = "asia-south1"
}

variable "image_tag" {
  description = "Image tag for this apply, normally the git SHA."
  type        = string
}

variable "notification_lead_service_url" {
  description = "URL of this environment's lead-service Cloud Run instance, consumed by notification-service (LEAD_SERVICE_URL). Fill in after the first apply."
  type        = string
}

variable "lead_billing_service_url" {
  description = "URL of this environment's billing-service Cloud Run instance, consumed by lead-service (BILLING_SERVICE_URL). Fill in after the first apply."
  type        = string
}

variable "cloudinary_cloud_name" {
  description = "Cloudinary cloud name (plain env var CLOUDINARY_CLOUD_NAME on package, billing, career)."
  type        = string
}

variable "email_from" {
  description = "Sender address for outgoing mail (plain env var EMAIL_FROM on notification, billing)."
  type        = string
}

variable "whatsapp_phone_number_id" {
  description = "Meta WhatsApp phone number id (plain env var WHATSAPP_PHONE_NUMBER_ID on notification)."
  type        = string
}

variable "whatsapp_business_account_id" {
  description = "Meta WhatsApp business account id (plain env var WHATSAPP_BUSINESS_ACCOUNT_ID on notification)."
  type        = string
}

variable "database_url" {
  description = "Supabase pooled connection string (DATABASE_URL, port 6543, pgbouncer=true)."
  type        = string
  sensitive   = true
}

variable "direct_url" {
  description = "Supabase direct connection string (DIRECT_URL, port 5432, used only by prisma migrate deploy)."
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "HS256 JWT secret shared by gateway and auth-service."
  type        = string
  sensitive   = true
}

variable "internal_service_key" {
  description = "Internal service-to-service key (user, package, billing)."
  type        = string
  sensitive   = true
}

variable "internal_events_token" {
  description = "Internal events token (billing, lead, notification)."
  type        = string
  sensitive   = true
}

variable "cloudinary_api_key" {
  description = "Cloudinary API key (package, billing, career)."
  type        = string
  sensitive   = true
}

variable "cloudinary_api_secret" {
  description = "Cloudinary API secret (package, billing, career)."
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Google Gemini API key (package)."
  type        = string
  sensitive   = true
}

variable "email_user" {
  description = "SMTP user (notification, booking)."
  type        = string
  sensitive   = true
}

variable "email_password" {
  description = "SMTP password — EMAIL_PASSWORD (notification) / EMAIL_PASS (booking)."
  type        = string
  sensitive   = true
}

variable "whatsapp_access_token" {
  description = "Meta WhatsApp System User permanent access token (notification)."
  type        = string
  sensitive   = true
}

variable "whatsapp_app_secret" {
  description = "Meta app secret signing inbound webhook payloads (notification)."
  type        = string
  sensitive   = true
}

variable "whatsapp_verify_token" {
  description = "WhatsApp webhook subscription verification token (notification)."
  type        = string
  sensitive   = true
}

variable "facebook_verify_token" {
  description = "Facebook webhook verification token (notification)."
  type        = string
  sensitive   = true
}

variable "facebook_app_secret" {
  description = "Facebook app secret (notification)."
  type        = string
  sensitive   = true
}

variable "facebook_page_access_token" {
  description = "Facebook page access token (notification)."
  type        = string
  sensitive   = true
}

variable "google_ads_webhook_key" {
  description = "Google Ads lead-form webhook verification key (notification)."
  type        = string
  sensitive   = true
}

variable "duffel_access_token" {
  description = "Duffel API access token (flight)."
  type        = string
  sensitive   = true
}

variable "travelport_client_id" {
  description = "Travelport+ client id (flight)."
  type        = string
  sensitive   = true
}

variable "travelport_client_secret" {
  description = "Travelport+ client secret (flight)."
  type        = string
  sensitive   = true
}

variable "travelport_token_url" {
  description = "Travelport+ token URL (flight)."
  type        = string
  sensitive   = true
}

variable "travelport_api_base_url" {
  description = "Travelport+ API base URL (flight)."
  type        = string
  sensitive   = true
}

variable "travelport_access_group" {
  description = "Travelport+ access group (flight)."
  type        = string
  sensitive   = true
}

variable "liteapi_api_key" {
  description = "LiteAPI hotel-search API key (package). Falls back to MockHotelClient when unset."
  type        = string
  sensitive   = true
}

variable "company_name" {
  description = "Company name (plain env var COMPANY_NAME on package, billing)."
  type        = string
}

variable "company_short_name" {
  description = "Company short name (plain env var COMPANY_SHORT_NAME on billing)."
  type        = string
}

variable "company_legal_name" {
  description = "Company legal name (plain env var COMPANY_LEGAL_NAME on billing)."
  type        = string
}

variable "company_tagline" {
  description = "Company tagline (plain env var COMPANY_TAGLINE on package, billing)."
  type        = string
}

variable "company_logo" {
  description = "Company logo (plain env var COMPANY_LOGO on package, billing)."
  type        = string
}

variable "company_address" {
  description = "Company address (plain env var COMPANY_ADDRESS on package, billing)."
  type        = string
}

variable "company_gst_number" {
  description = "Company GST number (plain env var COMPANY_GST_NUMBER on billing)."
  type        = string
}

variable "company_email" {
  description = "Company email (plain env var COMPANY_EMAIL on package, billing)."
  type        = string
}

variable "sales_email" {
  description = "Sales email (plain env var SALES_EMAIL on billing)."
  type        = string
}

variable "company_phone" {
  description = "Company phone (plain env var COMPANY_PHONE on package, billing)."
  type        = string
}

variable "company_whatsapp" {
  description = "Company WhatsApp number (plain env var COMPANY_WHATSAPP on billing)."
  type        = string
}

variable "company_website" {
  description = "Company website (plain env var COMPANY_WEBSITE on package, billing)."
  type        = string
}

variable "quotation_rating_tagline" {
  description = "Quotation rating tagline (plain env var QUOTATION_RATING_TAGLINE on package)."
  type        = string
}

variable "brand_ink" {
  description = "Brand ink color (plain env var BRAND_INK on billing)."
  type        = string
}

variable "brand_muted" {
  description = "Brand muted color (plain env var BRAND_MUTED on billing)."
  type        = string
}

variable "brand_accent" {
  description = "Brand accent color (plain env var BRAND_ACCENT on billing)."
  type        = string
}

variable "brand_accent_dark" {
  description = "Brand accent dark color (plain env var BRAND_ACCENT_DARK on billing)."
  type        = string
}

variable "quotation_default_terms" {
  description = "Quotation default terms (plain env var QUOTATION_DEFAULT_TERMS on billing)."
  type        = string
}

variable "quotation_cancellation_policy" {
  description = "Quotation cancellation policy (plain env var QUOTATION_CANCELLATION_POLICY on billing)."
  type        = string
}

variable "invoice_payment_terms" {
  description = "Invoice payment terms (plain env var INVOICE_PAYMENT_TERMS on billing)."
  type        = string
}

variable "invoice_payment_instructions" {
  description = "Invoice payment instructions (plain env var INVOICE_PAYMENT_INSTRUCTIONS on billing)."
  type        = string
}

variable "bank_name" {
  description = "Bank name (plain env var BANK_NAME on billing)."
  type        = string
}

variable "bank_account_name" {
  description = "Bank account name (plain env var BANK_ACCOUNT_NAME on billing)."
  type        = string
}

variable "bank_account_number" {
  description = "Bank account number (plain env var BANK_ACCOUNT_NUMBER on billing)."
  type        = string
}

variable "bank_ifsc_code" {
  description = "Bank IFSC code (plain env var BANK_IFSC_CODE on billing)."
  type        = string
}

variable "bank_swift_code" {
  description = "Bank SWIFT code (plain env var BANK_SWIFT_CODE on billing)."
  type        = string
}

variable "bank_branch" {
  description = "Bank branch (plain env var BANK_BRANCH on billing)."
  type        = string
}

variable "bank_account_type" {
  description = "Bank account type (plain env var BANK_ACCOUNT_TYPE on billing)."
  type        = string
}

variable "upi_id" {
  description = "UPI id (plain env var UPI_ID on billing)."
  type        = string
}

variable "whatsapp_template_language" {
  description = "WhatsApp template language (plain env var WHATSAPP_TEMPLATE_LANGUAGE on billing)."
  type        = string
}

variable "whatsapp_template_quotation" {
  description = "WhatsApp quotation template name (plain env var WHATSAPP_TEMPLATE_QUOTATION on billing)."
  type        = string
}

variable "whatsapp_template_invoice" {
  description = "WhatsApp invoice template name (plain env var WHATSAPP_TEMPLATE_INVOICE on billing)."
  type        = string
}

variable "whatsapp_template_receipt" {
  description = "WhatsApp receipt template name (plain env var WHATSAPP_TEMPLATE_RECEIPT on billing)."
  type        = string
}

variable "whatsapp_template_voucher" {
  description = "WhatsApp voucher template name (plain env var WHATSAPP_TEMPLATE_VOUCHER on billing)."
  type        = string
}

variable "admin_emails" {
  description = "Admin emails (plain env var ADMIN_EMAILS on career)."
  type        = string
}
# ── Voice agent (Retell AI) ────────────────────────────────────────────────
# Both are empty until this environment's TF_VARS_* secret carries them; the
# service rejects every webhook (503) and every tool call until then.
variable "retell_webhook_secret" {
  description = "Retell signing secret for the lifecycle webhooks (RETELL_WEBHOOK_SECRET on voice-service)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "retell_tool_secret" {
  description = "Shared secret the Retell CustomTools send in their headers field (RETELL_TOOL_SECRET on voice-service). Falls back to retell_webhook_secret when empty."
  type        = string
  sensitive   = true
  default     = ""
}


variable "client_url" {
  description = "Public origin of the Client SPA for this deployment."
  type        = string
  default     = ""
}

variable "management_url" {
  description = "Public origin of the Management SPA for this deployment."
  type        = string
  default     = ""
}

variable "duffel_webhook_secret" {
  description = "Duffel webhook signing secret."
  type        = string
  sensitive   = true
  default     = ""
}

variable "duffel_card_checkout_enabled" {
  description = "'true' enables Duffel card checkout."
  type        = string
  default     = "false"
}

variable "api_domain" {
  description = "Custom domain for the gateway (e.g. api.example.com). Empty disables the HTTPS load balancer and keeps the plain *.run.app URL."
  type        = string
  default     = ""
}
