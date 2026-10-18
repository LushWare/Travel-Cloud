variable "env" {
  description = "Environment name. Every resource in this module is prefixed with it (<env>-<name>) because Cloud Run service names, service-account ids, and Secret Manager secret ids are all unique per project and all three environments share one GCP project."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env must be dev, staging, or prod."
  }
}

variable "company_slug" {
  description = "Company identifier used only for resource labels / cost attribution (e.g. \"acme-travel\"). Isolation between companies comes from separate GCP/Supabase/Firebase projects, not from this label."
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
  description = "Image tag for this apply, normally the git SHA. Image references are composed as <region>-docker.pkg.dev/<project_id>/travel-crm/<service>:<env>-<image_tag>."
  type        = string
}

# lead-service and notification-service call each other at runtime
# (notification's LEAD_SERVICE_URL, lead's NOTIFICATION_SERVICE_URL). Wiring
# both directions through module outputs would create a Terraform dependency
# cycle, so exactly one side is supplied by this variable (see cloud_run.tf).
# It must hold THIS environment's lead-service Cloud Run URL — filled in after
# the first apply, the same pattern the plan uses for GATEWAY_URL in the
# GitHub Environments.
variable "notification_lead_service_url" {
  description = "URL of this environment's lead-service Cloud Run instance, consumed by notification-service as LEAD_SERVICE_URL. Cycle-breaker for the lead<->notification module-output loop."
  type        = string
}

variable "lead_billing_service_url" {
  description = "URL of this environment's billing-service Cloud Run instance, consumed by lead-service (BILLING_SERVICE_URL). Cycle-breaker for the lead<->billing module-output loop (billing-service already consumes lead-service's URL via module output). Fill in after the first apply, same pattern as notification_lead_service_url."
  type        = string
}

# Plain (non-secret) company-specific config from the plan's plain-env-var
# table. These are NOT secrets (Cloudinary cloud name is part of every public
# asset URL, etc.) but their values are per-company, so they flow through
# terraform.tfvars like everything else company-specific.
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

# ---------------------------------------------------------------------------
# Secret Manager secrets — the full 26-row table from the deployment plan.
# Every value is sensitive, required, and has no default: values must come
# from this environment's terraform.tfvars (gitignored). The actual created
# secret id is "<env>-<logical id>", see secrets.tf.
# ---------------------------------------------------------------------------

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
  description = "SMTP password — mounted as EMAIL_PASSWORD by notification-service and as EMAIL_PASS by booking-service (differing var names per each service's .env.example)."
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

# ---------------------------------------------------------------------------
# Branding / invoice / bank / admin-email plain config — read via
# process.env.X || <generic default> in package-service, billing-service,
# and career-service. Plain env, not Secret Manager, per the module's
# existing boundary (secrets = credentials/tokens/connection-strings only).
# ---------------------------------------------------------------------------

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

variable "management_copilot_enabled" {
  description = "Management Context Copilot server-side gate (plain env var MANAGEMENT_COPILOT_ENABLED on assistant-service). Anything other than \"true\" makes the turn/seen routes answer an undisclosed 404 — that is how the dark launch ships, so the default stays off and a new environment must opt in deliberately (see docs/designs/management-context-copilot.md, \"Feature flags\"). The client half of this gate is VITE_MANAGEMENT_COPILOT_ENABLED at build time; enabling one without the other ships a panel whose every request 404s."
  type        = string
  default     = "false"
}

variable "management_copilot_page_keys" {
  description = "Comma-separated page-key allowlist the copilot answers for (plain env var MANAGEMENT_COPILOT_PAGE_KEYS on assistant-service). Empty means every registered page; set it to roll a single page back without touching the main gate."
  type        = string
  default     = ""
}

variable "management_notifications_enabled" {
  description = "Business notification surface gate (plain env var MANAGEMENT_NOTIFICATIONS_ENABLED on assistant-service). The feed route answers an undisclosed 404 unless this is exactly \"true\" — the same dark-launch convention as MANAGEMENT_COPILOT_ENABLED, so the default stays off and an environment opts in deliberately. Unlike the copilot gate there is no build-time half: the bell is compiled into the Management bundle, so enabling this lights it for whoever can already see the page bar."
  type        = string
  default     = "false"
}
# ── Voice agent (Retell AI) ────────────────────────────────────────────────
# Empty is fail-closed, not inert: without the webhook secret the two lifecycle
# webhooks answer 503 and nothing is ever recorded; without the tool secret
# (or its webhook-secret fallback) every CustomTool call is rejected. That is
# deliberate — these routes are on the gateway's public allowlist, so an
# unconfigured environment must not accept anything. The values belong in each
# environment's TF_VARS_* secret (infra/CI-CD-SETUP.md); the empty default
# exists so a plan against an environment that has not been given them yet
# still succeeds.
variable "retell_webhook_secret" {
  description = "Retell signing secret for the inbound/post-call lifecycle webhooks (secret id <env>-retell-webhook-secret → RETELL_WEBHOOK_SECRET on voice-service). Also the fallback the CustomTool check uses when retell_tool_secret is empty."
  type        = string
  sensitive   = true
  default     = ""
}

variable "retell_tool_secret" {
  description = "Shared secret the Retell CustomTools carry in their own `headers` field (secret id <env>-retell-tool-secret → RETELL_TOOL_SECRET on voice-service). Retell documents no signature scheme for tool-call webhooks the way it does for the lifecycle ones, so this secret is what protects the seven tool endpoints."
  type        = string
  sensitive   = true
  default     = ""
}


variable "client_url" {
  description = "Public origin of the Client SPA. Empty keeps the per-env default (https://lush-ware-client-<env>.web.app)."
  type        = string
  default     = ""
}

variable "management_url" {
  description = "Public origin of the Management SPA. Empty keeps the per-env default (https://lush-ware-management-<env>.web.app)."
  type        = string
  default     = ""
}

# Fails closed: flight-service answers 503 to Duffel webhooks until this is set.
variable "duffel_webhook_secret" {
  description = "Duffel webhook signing secret (secret id <env>-duffel-webhook-secret -> DUFFEL_WEBHOOK_SECRET on flight-service)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "duffel_card_checkout_enabled" {
  description = "'true' enables Duffel card checkout on flight-service (DUFFEL_CARD_CHECKOUT_ENABLED)."
  type        = string
  default     = "false"
}

variable "api_domain" {
  description = "Custom domain for the gateway (e.g. api.example.com). Empty disables the HTTPS load balancer and keeps the plain *.run.app URL."
  type        = string
  default     = ""
}
