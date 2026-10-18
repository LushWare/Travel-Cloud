#!/usr/bin/env bash
#
# Create the GitHub `prod` Environment and load its secrets and variables, so a
# push to `main` can deploy to the prod GCP project.
#
# Secret values are read from the gitignored infra/terraform/deployments/prod/
# terraform.tfvars and piped straight into `gh` -- they are never echoed,
# never put on a command line, and never written anywhere else.
#
# Needs: `gh` logged in with admin rights on the repository.
#
# Usage:  infra/scripts/set-github-prod-env.sh            (apply)
#         DRY_RUN=1 infra/scripts/set-github-prod-env.sh  (names only)
set -euo pipefail

REPO="${REPO:-LushWare/Travel-Cloud}"
ENVIRONMENT="prod"
PROJECT_ID="${PROJECT_ID:-lush-travel-cloud-prod}"
PROJECT_NUMBER="${PROJECT_NUMBER:-237831598037}"
REGION="${REGION:-asia-south1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TFVARS="$ROOT/infra/terraform/deployments/prod/terraform.tfvars"
[[ -f "$TFVARS" ]] || { echo "missing $TFVARS" >&2; exit 1; }

WIF="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider"
sa() { echo "$1@${PROJECT_ID}.iam.gserviceaccount.com"; }

# Read one `key = "value"` from the tfvars without printing it.
tfvar() {
  python3 -I - "$TFVARS" "$1" <<'EOF'
import re, sys, json
text = open(sys.argv[1]).read()
m = re.search(rf'(?m)^{re.escape(sys.argv[2])}\s*=\s*(".*")\s*$', text)
if not m:
    sys.exit(f"{sys.argv[2]} not found in tfvars")
sys.stdout.write(json.loads(m.group(1)))
EOF
}

run() { if [[ "${DRY_RUN:-0}" == "1" ]]; then echo "+ $*"; else "$@"; fi; }

echo "==> Environment '$ENVIRONMENT' on $REPO"
# Creating an environment needs repo ADMIN; filling one needs only write access.
# So if it already exists (e.g. an admin created it in the UI), skip creation.
if gh api "repos/$REPO/environments/$ENVIRONMENT" --silent 2>/dev/null; then
  echo "  already exists"
else
  run gh api -X PUT "repos/$REPO/environments/$ENVIRONMENT" --silent || {
    echo "Could not create it: an admin must create the '$ENVIRONMENT' environment" >&2
    echo "(Settings -> Environments -> New environment), then re-run this script." >&2
    exit 1
  }
fi

echo "==> Variables (not sensitive)"
set_var() { run gh variable set "$1" --repo "$REPO" --env "$ENVIRONMENT" --body "$2"; echo "  $1"; }
set_var GCP_PROJECT_ID  "$PROJECT_ID"
set_var GCP_REGION      "$REGION"
set_var GCP_FIREBASE_SA "$(sa firebase-hosting-deployer)"
# The frontends are built against this. API_DOMAIN is the public custom domain
# (see api_domain in terraform.tfvars); fall back to Cloud Run's deterministic
# URL for an environment that has no custom domain yet.
API_DOMAIN="${API_DOMAIN:-api.lushtravelcloud.com}"
if [[ -n "$API_DOMAIN" ]]; then
  set_var GATEWAY_URL "https://${API_DOMAIN}/api/v1"
else
  set_var GATEWAY_URL "https://prod-gateway-${PROJECT_NUMBER}.${REGION}.run.app/api/v1"
fi

echo "==> Secrets"
set_secret() { # name, then value on stdin
  if [[ "${DRY_RUN:-0}" == "1" ]]; then cat >/dev/null; echo "+ gh secret set $1 --env $ENVIRONMENT (value hidden)"
  else gh secret set "$1" --repo "$REPO" --env "$ENVIRONMENT"; echo "  $1"; fi
}
printf '%s' "$WIF"                 | set_secret GCP_WIF_PROVIDER
sa github-actions-deployer | tr -d '\n' | set_secret GCP_DEPLOY_SA
sa terraform-deployer      | tr -d '\n' | set_secret GCP_TERRAFORM_SA
tfvar database_url         | set_secret SUPABASE_DATABASE_URL
tfvar direct_url           | set_secret SUPABASE_DIRECT_URL
# The whole tfvars file: Terraform's only source of secrets and config in CI.
set_secret TF_VARS_PROD < "$TFVARS"

echo
echo "Done. Verify names (values are never shown):"
echo "  gh secret list   --repo $REPO --env $ENVIRONMENT"
echo "  gh variable list --repo $REPO --env $ENVIRONMENT"
