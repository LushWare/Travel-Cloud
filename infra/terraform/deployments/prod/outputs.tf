output "gateway_url" {
  description = "URL of this environment's gateway Cloud Run service."
  value       = module.deployment.gateway_url
}

output "auth_service_url" {
  description = "URL of this environment's auth-service Cloud Run service."
  value       = module.deployment.auth_service_url
}

output "user_service_url" {
  description = "URL of this environment's user-service Cloud Run service."
  value       = module.deployment.user_service_url
}

output "package_service_url" {
  description = "URL of this environment's package-service Cloud Run service."
  value       = module.deployment.package_service_url
}

output "lead_service_url" {
  description = "URL of this environment's lead-service Cloud Run service."
  value       = module.deployment.lead_service_url
}

output "booking_service_url" {
  description = "URL of this environment's booking-service Cloud Run service."
  value       = module.deployment.booking_service_url
}

output "billing_service_url" {
  description = "URL of this environment's billing-service Cloud Run service."
  value       = module.deployment.billing_service_url
}

output "career_service_url" {
  description = "URL of this environment's career-service Cloud Run service."
  value       = module.deployment.career_service_url
}

output "flight_service_url" {
  description = "URL of this environment's flight-service Cloud Run service."
  value       = module.deployment.flight_service_url
}

output "analytics_service_url" {
  description = "URL of this environment's analytics-service Cloud Run service."
  value       = module.deployment.analytics_service_url
}

output "notification_service_url" {
  description = "URL of this environment's notification-service Cloud Run service."
  value       = module.deployment.notification_service_url
}

output "api_lb_ip" {
  description = "Static IP to point the API domain's A record at (empty when api_domain is unset)."
  value       = module.deployment.api_lb_ip
}
