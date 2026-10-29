output "gateway_url" {
  description = "URL of this environment's gateway Cloud Run service."
  value       = module.gateway.uri
}

output "auth_service_url" {
  description = "URL of this environment's auth-service Cloud Run service."
  value       = module.auth_service.uri
}

output "user_service_url" {
  description = "URL of this environment's user-service Cloud Run service."
  value       = module.user_service.uri
}

output "package_service_url" {
  description = "URL of this environment's package-service Cloud Run service."
  value       = module.package_service.uri
}

output "lead_service_url" {
  description = "URL of this environment's lead-service Cloud Run service."
  value       = module.lead_service.uri
}

output "booking_service_url" {
  description = "URL of this environment's booking-service Cloud Run service."
  value       = module.booking_service.uri
}

output "billing_service_url" {
  description = "URL of this environment's billing-service Cloud Run service."
  value       = module.billing_service.uri
}

output "career_service_url" {
  description = "URL of this environment's career-service Cloud Run service."
  value       = module.career_service.uri
}

output "flight_service_url" {
  description = "URL of this environment's flight-service Cloud Run service."
  value       = module.flight_service.uri
}

output "analytics_service_url" {
  description = "URL of this environment's analytics-service Cloud Run service."
  value       = module.analytics_service.uri
}

output "assistant_service_url" {
  description = "URL of this environment's assistant-service Cloud Run service."
  value       = module.assistant_service.uri
}

output "notification_service_url" {
  description = "URL of this environment's notification-service Cloud Run service."
  value       = module.notification_service.uri
}
output "voice_service_url" {
  description = "URL of this environment's voice-service Cloud Run service. ElevenLabs posts lifecycle webhooks and tool calls to the gateway, so this URL is only used for direct diagnosis."
  value       = module.voice_service.uri
}
