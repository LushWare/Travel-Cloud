#!/usr/bin/env bash
#
# Build and deploy the Landing marketing site to Firebase Hosting.
#
# Landing is a standalone marketing page with no backend; its only build-time
# inputs are the two portal URLs it links out to (src/config/portals.js).
# Those default to the production custom domains, so every non-prod deploy has
# to pass the matching environment's URLs explicitly -- otherwise a dev deploy
# would hand visitors off to production portals (or to domains that do not
# exist yet) while looking perfectly healthy.
#
# Usage:
#   scripts/deploy-landing.sh [dev|staging|prod]
#
# Override either URL by exporting VITE_MANAGEMENT_URL / VITE_CLIENT_URL.
set -euo pipefail

TARGET_ENV="${1:-dev}"
case "$TARGET_ENV" in
  dev | staging | prod) ;;
  *)
    echo "usage: $0 [dev|staging|prod]" >&2
    exit 2
    ;;
esac

# prod lives in its own GCP project; dev/staging stay in the original one.
if [[ "$TARGET_ENV" == "prod" ]]; then
  PROJECT="lush-travel-cloud-prod"
else
  PROJECT="travelcrm-506818"
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Where each environment's portals actually live. dev/staging use the deployed
# Firebase Hosting sites; prod uses the production custom domains.
if [[ "$TARGET_ENV" == "prod" ]]; then
  : "${VITE_MANAGEMENT_URL:=https://app.lushtravelcloud.com}"
  : "${VITE_CLIENT_URL:=https://user.lushtravelcloud.com}"
else
  : "${VITE_MANAGEMENT_URL:=https://lush-ware-management-$TARGET_ENV.web.app}"
  : "${VITE_CLIENT_URL:=https://lush-ware-client-$TARGET_ENV.web.app}"
fi

echo "Building Landing for '$TARGET_ENV'"
echo "  management -> $VITE_MANAGEMENT_URL"
echo "  client     -> $VITE_CLIENT_URL"

cd "$ROOT/Landing"
[[ -d node_modules ]] || npm ci
VITE_MANAGEMENT_URL="$VITE_MANAGEMENT_URL" \
  VITE_CLIENT_URL="$VITE_CLIENT_URL" \
  npm run build

# A build that kept the production defaults would still look fine and silently
# mis-route every visitor, so make the compiled bundle prove which URLs it has.
for url in "$VITE_MANAGEMENT_URL" "$VITE_CLIENT_URL"; do
  grep -rq -- "$url" dist || {
    echo "FAIL: '$url' not found in Landing/dist -- refusing to deploy" >&2
    exit 1
  }
done

cd "$ROOT"
npx --yes firebase-tools@latest deploy \
  --only "hosting:landing-$TARGET_ENV" \
  --project "$PROJECT"
