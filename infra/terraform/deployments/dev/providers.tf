terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = ">= 4.0"
    }
  }

  backend "gcs" {
    bucket = "lush-ware-travel-crm-tfstate"
    prefix = "travel-crm/dev"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
