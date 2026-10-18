# All 14 Cloud Run services, one per Services/* directory. `name` and the
# matching service-account id are env-prefixed ("<env>-<service>") because
# Cloud Run service names and service-account ids are unique per project and
# all three environments share one GCP project (longest resulting id,
# staging-notification-service, is 28 chars — under GCP's 30-char limit).
#
# `secrets` holds the env-prefixed Secret Manager ids this service reads
# (consumers per the plan's Secret Manager table); `plain_env` holds the
# plain (non-secret) vars set directly on the service. `allow_unauthenticated`
# is true only for the gateway — the two SPAs call it directly — and false
# for all 12 backends, which are reachable only via the gateway's
# run.invoker grant (iam.tf) plus its Google-signed ID token.
locals {
  # Frontend origins. Default to the per-env Firebase Hosting sites; a deployment
  # whose sites have other ids (or custom domains) overrides them via the
  # client_url / management_url variables.
  client_url     = var.client_url != "" ? var.client_url : "https://lush-ware-client-${var.env}.web.app"
  management_url = var.management_url != "" ? var.management_url : "https://lush-ware-management-${var.env}.web.app"

  services = {
    gateway = {
      name    = "${var.env}-gateway"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-jwt-secret"]
      plain_env = {
        NODE_ENV       = "production"
        CLIENT_URL     = local.client_url
        MANAGEMENT_URL = local.management_url
      }
      allow_unauthenticated = true
    }
    auth-service = {
      name                  = "${var.env}-auth-service"
      memory                = "512Mi"
      cpu                   = "1"
      secrets               = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-jwt-secret", "${var.env}-internal-events-token"]
      plain_env             = { NODE_ENV = "production", CLIENT_URL = local.client_url }
      allow_unauthenticated = false
    }
    user-service = {
      name                  = "${var.env}-user-service"
      memory                = "512Mi"
      cpu                   = "1"
      secrets               = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-internal-service-key"]
      plain_env             = { NODE_ENV = "production" }
      allow_unauthenticated = false
    }
    package-service = {
      name    = "${var.env}-package-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-internal-service-key", "${var.env}-cloudinary-api-key", "${var.env}-cloudinary-api-secret", "${var.env}-gemini-api-key", "${var.env}-liteapi-api-key"]
      plain_env = {
        NODE_ENV = "production"
        # The code default is a thinking model, and the customer Client aborts
        # these AI routes at 15s, so the lite tier is what can actually finish
        # inside that window.
        GEMINI_MODEL             = "gemini-3.5-flash-lite"
        CLOUDINARY_CLOUD_NAME    = var.cloudinary_cloud_name
        COMPANY_NAME             = var.company_name
        COMPANY_TAGLINE          = var.company_tagline
        QUOTATION_RATING_TAGLINE = var.quotation_rating_tagline
        COMPANY_LOGO             = var.company_logo
        COMPANY_ADDRESS          = var.company_address
        COMPANY_PHONE            = var.company_phone
        COMPANY_EMAIL            = var.company_email
        COMPANY_WEBSITE          = var.company_website
      }
      allow_unauthenticated = false
    }
    lead-service = {
      name                  = "${var.env}-lead-service"
      memory                = "512Mi"
      cpu                   = "1"
      secrets               = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-internal-events-token"]
      plain_env             = { NODE_ENV = "production" }
      allow_unauthenticated = false
    }
    booking-service = {
      name    = "${var.env}-booking-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-database-url", "${var.env}-direct-url"]
      plain_env = {
        NODE_ENV   = "production"
        CLIENT_URL = local.client_url
      }
      allow_unauthenticated = false
    }
    billing-service = {
      name    = "${var.env}-billing-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-internal-service-key", "${var.env}-internal-events-token", "${var.env}-cloudinary-api-key", "${var.env}-cloudinary-api-secret"]
      plain_env = {
        NODE_ENV                      = "production"
        CLOUDINARY_CLOUD_NAME         = var.cloudinary_cloud_name
        EMAIL_FROM                    = var.email_from
        COMPANY_NAME                  = var.company_name
        COMPANY_SHORT_NAME            = var.company_short_name
        COMPANY_LEGAL_NAME            = var.company_legal_name
        COMPANY_TAGLINE               = var.company_tagline
        COMPANY_LOGO                  = var.company_logo
        COMPANY_ADDRESS               = var.company_address
        COMPANY_GST_NUMBER            = var.company_gst_number
        COMPANY_EMAIL                 = var.company_email
        SALES_EMAIL                   = var.sales_email
        COMPANY_PHONE                 = var.company_phone
        COMPANY_WHATSAPP              = var.company_whatsapp
        COMPANY_WEBSITE               = var.company_website
        BRAND_INK                     = var.brand_ink
        BRAND_MUTED                   = var.brand_muted
        BRAND_ACCENT                  = var.brand_accent
        BRAND_ACCENT_DARK             = var.brand_accent_dark
        QUOTATION_DEFAULT_TERMS       = var.quotation_default_terms
        QUOTATION_CANCELLATION_POLICY = var.quotation_cancellation_policy
        INVOICE_PAYMENT_TERMS         = var.invoice_payment_terms
        INVOICE_PAYMENT_INSTRUCTIONS  = var.invoice_payment_instructions
        BANK_NAME                     = var.bank_name
        BANK_ACCOUNT_NAME             = var.bank_account_name
        BANK_ACCOUNT_NUMBER           = var.bank_account_number
        BANK_IFSC_CODE                = var.bank_ifsc_code
        BANK_SWIFT_CODE               = var.bank_swift_code
        BANK_BRANCH                   = var.bank_branch
        BANK_ACCOUNT_TYPE             = var.bank_account_type
        UPI_ID                        = var.upi_id
        WHATSAPP_TEMPLATE_LANGUAGE    = var.whatsapp_template_language
        WHATSAPP_TEMPLATE_QUOTATION   = var.whatsapp_template_quotation
        WHATSAPP_TEMPLATE_INVOICE     = var.whatsapp_template_invoice
        WHATSAPP_TEMPLATE_RECEIPT     = var.whatsapp_template_receipt
        WHATSAPP_TEMPLATE_VOUCHER     = var.whatsapp_template_voucher
      }
      allow_unauthenticated = false
    }
    career-service = {
      name    = "${var.env}-career-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-cloudinary-api-key", "${var.env}-cloudinary-api-secret"]
      plain_env = {
        NODE_ENV              = "production"
        CLOUDINARY_CLOUD_NAME = var.cloudinary_cloud_name
        ADMIN_EMAILS          = var.admin_emails
      }
      allow_unauthenticated = false
    }
    flight-service = {
      name    = "${var.env}-flight-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-duffel-access-token", "${var.env}-duffel-webhook-secret", "${var.env}-travelport-client-id", "${var.env}-travelport-client-secret", "${var.env}-travelport-token-url", "${var.env}-travelport-api-base-url", "${var.env}-travelport-access-group"]
      plain_env = {
        NODE_ENV             = "production"
        CLIENT_URL           = local.client_url
        MANAGEMENT_URL       = local.management_url
        TRAVELPORT_MOCK_MODE = "true"
        # Card checkout via Duffel is opt-in per deployment.
        DUFFEL_CARD_CHECKOUT_ENABLED = var.duffel_card_checkout_enabled
      }
      allow_unauthenticated = false
    }
    analytics-service = {
      name    = "${var.env}-analytics-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-database-url", "${var.env}-direct-url"]
      plain_env = {
        NODE_ENV   = "production"
        CLIENT_URL = local.client_url
      }
      allow_unauthenticated = false
    }
    assistant-service = {
      name    = "${var.env}-assistant-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-internal-service-key", "${var.env}-gemini-api-key"]
      plain_env = {
        NODE_ENV                                  = "production"
        CLIENT_URL                                = local.client_url
        MANAGEMENT_COPILOT_ENABLED                = var.management_copilot_enabled
        MANAGEMENT_COPILOT_PAGE_KEYS              = var.management_copilot_page_keys
        MANAGEMENT_NOTIFICATIONS_ENABLED          = var.management_notifications_enabled
        ASSISTANT_CONVERSATIONAL_OUTCOMES_ENABLED = "true"
        # The briefing and the ask loop both run on this one model. The flash tier
        # thinks: measured at ~1000 thinking tokens and 5.7s on a prompt far
        # smaller than a real briefing, which overran the generation deadline
        # and reached operators as "I could not generate an answer just now".
        # The lite tier does no thinking and returns the same structured answer.
        GEMINI_MODEL = "gemini-3.5-flash-lite"
        # Classified inside a 1.5s budget (assistantRouter.js), which the
        # thinking default can never meet.
        GEMINI_ROUTER_MODEL                  = "gemini-3.5-flash-lite"
        ASSISTANT_ROUTER_SOCIAL_ENABLED      = "false"
        ASSISTANT_ROUTER_OFF_TOPIC_ENABLED   = "false"
        ASSISTANT_ROUTER_SOCIAL_THRESHOLD    = "0.95"
        ASSISTANT_ROUTER_OFF_TOPIC_THRESHOLD = "0.95"
        # Grounded travel search. Billed per search query the model executes, and
        # scoped by src/ai/travelDomain.js rather than by this flag; set it to
        # "false" to switch the tool off in an environment entirely.
        ASSISTANT_TRAVEL_SEARCH_ENABLED = "true"
      }
      allow_unauthenticated = false
    }
    notification-service = {
      name    = "${var.env}-notification-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-internal-events-token", "${var.env}-email-user", "${var.env}-email-password", "${var.env}-whatsapp-access-token", "${var.env}-whatsapp-app-secret", "${var.env}-whatsapp-verify-token", "${var.env}-facebook-verify-token", "${var.env}-facebook-app-secret", "${var.env}-facebook-page-access-token"]
      plain_env = {
        NODE_ENV                     = "production"
        LEAD_SERVICE_URL             = var.notification_lead_service_url
        EMAIL_HOST                   = "smtp.gmail.com"
        EMAIL_PORT                   = "587"
        EMAIL_SECURE                 = "false"
        EMAIL_FROM                   = var.email_from
        WHATSAPP_PHONE_NUMBER_ID     = var.whatsapp_phone_number_id
        WHATSAPP_BUSINESS_ACCOUNT_ID = var.whatsapp_business_account_id
        WHATSAPP_API_VERSION         = "v23.0"
      }
      allow_unauthenticated = false
    }
    voice-service = {
      name    = "${var.env}-voice-service"
      memory  = "512Mi"
      cpu     = "1"
      secrets = ["${var.env}-database-url", "${var.env}-direct-url", "${var.env}-internal-service-key", "${var.env}-internal-events-token", "${var.env}-retell-webhook-secret", "${var.env}-retell-tool-secret"]
      plain_env = {
        NODE_ENV   = "production"
        CLIENT_URL = local.client_url
        # The sales-team email and the record deep-links both point at the
        # Management portal, so this service needs that URL too.
        MANAGEMENT_URL = local.management_url
        # Calls from one number acted on per rolling 24h. Retell has no
        # documented way to refuse a call already ringing, so the call is
        # answered either way — past the cap this only stops the forwarding
        # into lead-service/notification-service.
        VOICE_MAX_CALLS_PER_NUMBER_PER_DAY = "20"
      }
      allow_unauthenticated = false
    }
  }

  # Flattened service -> secret bindings, used by iam.tf to scope each
  # service account's secretAccessor grant to its own secrets only.
  service_secret_bindings = flatten([
    for service_key, svc in local.services : [
      for secret_id in svc.secrets : {
        service_key = service_key
        secret_id   = secret_id
      }
    ]
  ])
}
