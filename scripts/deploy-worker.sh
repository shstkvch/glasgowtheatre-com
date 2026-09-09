#!/usr/bin/env bash
#
# Deploy the Worker that triggers the daily build.
#
# This is stage 9 of setup-cloudflare.sh on its own, for when the rest of the
# setup is already done. Without it nothing runs on a schedule: Cloudflare
# Pages only rebuilds when something tells it to.
#
#   ./scripts/deploy-worker.sh
#
# Opens a browser once for `wrangler login`. Needs DEPLOY_HOOK in .env.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

green() { printf '\033[32m%s\033[0m\n' "$1"; }
warn()  { printf '\033[33m%s\033[0m\n' "$1"; }
die()   { printf '\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[ -f .env ] || die "No .env — run ./scripts/setup-cloudflare.sh first."
set -a; . ./.env; set +a

[ -n "${DEPLOY_HOOK:-}" ] || die \
  "DEPLOY_HOOK is not in .env. Get it from the Pages project:
   Settings → Builds & deployments → Deploy hooks → Add deploy hook
   then add it to .env as DEPLOY_HOOK=https://..."

# A key for triggering a build by hand, so the wiring can be tested without
# waiting for tomorrow's cron.
if [ -z "${TRIGGER_KEY:-}" ]; then
  TRIGGER_KEY="$(LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom | head -c 32)"
  printf 'TRIGGER_KEY=%s\n' "$TRIGGER_KEY" >> .env
  green "Generated TRIGGER_KEY and saved it to .env"
fi

cd cloudflare

if ! npx --yes wrangler whoami >/dev/null 2>&1; then
  echo
  warn "Opening a browser to log in to Cloudflare..."
  npx --yes wrangler login
fi
green "Authenticated as: $(npx --yes wrangler whoami 2>/dev/null | grep -i 'associated with the email' || echo 'unknown')"

echo
echo "Setting secrets..."
printf '%s' "$DEPLOY_HOOK" | npx --yes wrangler secret put DEPLOY_HOOK
printf '%s' "$TRIGGER_KEY" | npx --yes wrangler secret put TRIGGER_KEY

echo
echo "Deploying..."
npx --yes wrangler deploy

echo
green "Deployed. The cron schedule should be listed above as 17 5 * * *."
echo
echo "Test it end to end without waiting for tomorrow:"
echo "  curl -X POST \"\$DEPLOY_HOOK\"           # start a build directly"
echo "  npx wrangler tail                        # watch the Worker fire"
echo
echo "Check the build actually reached the venues:"
echo "  curl -s https://glasgowtheatre.com/data/status.json"
