resource "google_project_service" "cloudkms" {
  project            = var.project_id
  service            = "cloudkms.googleapis.com"
  disable_on_destroy = false
}

resource "google_kms_key_ring" "integrations" {
  project  = var.project_id
  name     = "${var.env}-integrations"
  location = var.region

  depends_on = [google_project_service.cloudkms]
}

resource "google_kms_crypto_key" "integrations" {
  name            = "integrations-kek"
  key_ring        = google_kms_key_ring.integrations.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "integration_service" {
  crypto_key_id = google_kms_crypto_key.integrations.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.services["integration-service"].email}"
}
