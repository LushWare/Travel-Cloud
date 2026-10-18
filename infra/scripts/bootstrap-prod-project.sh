#!/usr/bin/env bash
#
# One-time bootstrap of the prod GCP project: project + billing, APIs, Terraform
# state bucket, GitHub OIDC (Workload Identity Federation), the three CI service
# accounts, and the Firebase Hosting sites.
#
# Idempotent: every step checks before it creates, so a re-run after a partial
# failure is safe. Nothing here deletes or overwrites anything.
#
# Every gcloud call passes --project explicitly -- it never relies on the active
# gcloud configuration, which on a shared machine may point at another project.
#
# Usage:
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX infra/scripts/bootstrap-prod-project.sh
#
# Run as a principal that can create projects and link billing (and that is
# Owner of the new project). Pass DRY_RUN=1 to print the commands only.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-lush-travel-cloud-prod}"
PROJECT_NAME="${PROJECT_NAME:-Travel-Cloud}"
REGION="${REGION:-asia-south1}"
GITHUB_REPO="${GITHUB_REPO:-LushWare/Travel-Cloud}"
STATE_BUCKET="${STATE_BUCKET:-lush-travel-cloud-prod-tfstate}"
STATE_LOCATION="${STATE_LOCATION:-asia-southeast1}"
: "${BILLING_ACCOUNT:?set BILLING_ACCOUNT to the billing account id (gcloud billing accounts list)}"

POOL="github-actions-pool"
PROVIDER="github-actions-provider"
DEPLOY_SA="github-actions-deployer"
FIREBASE_SA="firebase-hosting-deployer"
TERRAFORM_SA="terraform-deployer"
SITES=(lush-travel-cloud-client lush-travel-cloud-management lush-travel-cloud-landing)

run() {
  if [[ "${DRY_RUN:-0}" == "1" ]]; then echo "+ $*"; else "$@"; fi
}
log() { echo; echo "==> $*"; }
sa_email() { echo "$1@${PROJECT_ID}.iam.gserviceaccount.com"; }

log "Project $PROJECT_ID ($PROJECT_NAME)"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "exists"
else
  run gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
fi
run gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"

log "Enabling APIs"
run gcloud services enable \
  run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com \
  iam.googleapis.com cloudresourcemanager.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com \
  serviceusage.googleapis.com --project="$PROJECT_ID"

log "Terraform state bucket gs://$STATE_BUCKET"
if gcloud storage buckets describe "gs://$STATE_BUCKET" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "exists"
else
  run gcloud storage buckets create "gs://$STATE_BUCKET" --project="$PROJECT_ID" \
    --location="$STATE_LOCATION" --uniform-bucket-level-access
fi
run gcloud storage buckets update "gs://$STATE_BUCKET" --project="$PROJECT_ID" --versioning

log "Service accounts"
for sa in "$DEPLOY_SA" "$FIREBASE_SA" "$TERRAFORM_SA"; do
  if gcloud iam service-accounts describe "$(sa_email "$sa")" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "$sa exists"
  else
    run gcloud iam service-accounts create "$sa" --project="$PROJECT_ID" --display-name="$sa"
  fi
done

log "Project roles"
bind() {
  run gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$(sa_email "$1")" --role="$2" --condition=None --quiet
}
# Ships code: push images, deploy revisions, act as the per-service runtime SAs.
bind "$DEPLOY_SA" roles/run.admin
bind "$DEPLOY_SA" roles/artifactregistry.writer
bind "$DEPLOY_SA" roles/iam.serviceAccountUser
# Ships the three frontends.
bind "$FIREBASE_SA" roles/firebasehosting.admin
# Reshapes infrastructure -- deliberately a separate identity from the deployer.
bind "$TERRAFORM_SA" roles/editor
bind "$TERRAFORM_SA" roles/run.admin
bind "$TERRAFORM_SA" roles/secretmanager.admin
bind "$TERRAFORM_SA" roles/iam.serviceAccountUser

log "Workload Identity Federation (pool locked to $GITHUB_REPO)"
if ! gcloud iam workload-identity-pools describe "$POOL" --project="$PROJECT_ID" --location=global >/dev/null 2>&1; then
  run gcloud iam workload-identity-pools create "$POOL" --project="$PROJECT_ID" \
    --location=global --display-name="GitHub Actions Pool"
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT_ID" \
  --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  # The attribute condition is a hard gate: without it any GitHub repo could
  # federate into this pool. It pins the exact repository, not just the owner.
  run gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --project="$PROJECT_ID" --location=global --workload-identity-pool="$POOL" \
    --display-name="GitHub Actions Provider" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
fi

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  PROJECT_NUMBER="<project-number>"
else
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
fi
MEMBER="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}"
for sa in "$DEPLOY_SA" "$FIREBASE_SA" "$TERRAFORM_SA"; do
  run gcloud iam service-accounts add-iam-policy-binding "$(sa_email "$sa")" \
    --project="$PROJECT_ID" --role=roles/iam.workloadIdentityUser --member="$MEMBER" --quiet
done

log "Firebase Hosting sites (needs: firebase login, as an Owner of $PROJECT_ID)"
if firebase projects:list 2>/dev/null | grep -q "$PROJECT_ID"; then
  echo "project already has Firebase"
else
  run firebase projects:addfirebase "$PROJECT_ID"
fi
for site in "${SITES[@]}"; do
  if firebase hosting:sites:list --project "$PROJECT_ID" 2>/dev/null | grep -q "$site"; then
    echo "$site exists"
  else
    run firebase hosting:sites:create "$site" --project "$PROJECT_ID"
  fi
done

log "Done. Values for the GitHub 'prod' environment"
cat <<EOF

  secrets:
    GCP_WIF_PROVIDER   projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}
    GCP_DEPLOY_SA      $(sa_email "$DEPLOY_SA")
    GCP_TERRAFORM_SA   $(sa_email "$TERRAFORM_SA")
  variables:
    GCP_PROJECT_ID     ${PROJECT_ID}
    GCP_REGION         ${REGION}
    GCP_FIREBASE_SA    $(sa_email "$FIREBASE_SA")
    GATEWAY_URL        (set after the first Terraform apply: https://<gateway-url>/api/v1)

  Still set by hand: SUPABASE_DATABASE_URL, SUPABASE_DIRECT_URL, TF_VARS_PROD.
EOF
