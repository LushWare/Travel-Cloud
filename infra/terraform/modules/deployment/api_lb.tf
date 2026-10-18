# Custom domain for the API gateway, via a global external HTTPS load balancer.
#
# Cloud Run domain mappings are refused in asia-south1 ("Creating domain
# mappings is not allowed in this region"), and Firebase Hosting rewrites strip
# every cookie but __session, which would break the httpOnly auth cookies. A
# serverless-NEG load balancer is the supported way to put a domain on a Cloud
# Run service in this region.
#
# Off unless var.api_domain is set, so environments that keep using the plain
# *.run.app URL (dev, staging) are untouched. Nothing here carries traffic until
# DNS for api_domain points at the reserved address (output api_lb_ip).
locals {
  api_lb_enabled = var.api_domain != ""
}

resource "google_project_service" "compute" {
  count = local.api_lb_enabled ? 1 : 0

  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_global_address" "api" {
  count = local.api_lb_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.env}-api-lb-ip"

  depends_on = [google_project_service.compute]
}

resource "google_compute_region_network_endpoint_group" "gateway" {
  count = local.api_lb_enabled ? 1 : 0

  project               = var.project_id
  name                  = "${var.env}-gateway-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = module.gateway.name
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_backend_service" "gateway" {
  count = local.api_lb_enabled ? 1 : 0

  project               = var.project_id
  name                  = "${var.env}-gateway-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  # No timeout_sec: Google rejects it on a backend that fronts a serverless NEG.
  # The request deadline is the Cloud Run service's own timeout.

  backend {
    group = google_compute_region_network_endpoint_group.gateway[0].id
  }

  depends_on = [google_project_service.compute]
}

resource "google_compute_url_map" "api" {
  count = local.api_lb_enabled ? 1 : 0

  project         = var.project_id
  name            = "${var.env}-api-lb"
  default_service = google_compute_backend_service.gateway[0].id

  depends_on = [google_project_service.compute]
}

resource "google_compute_managed_ssl_certificate" "api" {
  count = local.api_lb_enabled ? 1 : 0

  project = var.project_id
  name    = "${var.env}-api-cert"

  managed {
    domains = [var.api_domain]
  }

  # A cert cannot be edited in place; replacing it must not drop the proxy.
  lifecycle {
    create_before_destroy = true
  }

  # Enabling the Compute API takes a moment to propagate; without this the cert
  # was created first and refused with "Compute Engine API has not been used".
  depends_on = [google_project_service.compute]
}

resource "google_compute_target_https_proxy" "api" {
  count = local.api_lb_enabled ? 1 : 0

  project          = var.project_id
  name             = "${var.env}-api-https-proxy"
  url_map          = google_compute_url_map.api[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.api[0].id]

  depends_on = [google_project_service.compute]
}

resource "google_compute_global_forwarding_rule" "api_https" {
  count = local.api_lb_enabled ? 1 : 0

  project               = var.project_id
  name                  = "${var.env}-api-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.api[0].address
  ip_protocol           = "TCP"
  port_range            = "443"
  target                = google_compute_target_https_proxy.api[0].id

  depends_on = [google_project_service.compute]
}

output "api_lb_ip" {
  description = "Static IPv4 address for api_domain: the A record to create at the DNS provider. Empty when api_domain is unset."
  value       = local.api_lb_enabled ? google_compute_global_address.api[0].address : ""
}
