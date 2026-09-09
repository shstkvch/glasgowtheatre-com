#!/usr/bin/env bash
#
# Refresh the listings and publish the site.
#
# This is the whole daily job in one place, so it can be driven by anything
# that can run a command on a schedule: launchd on a Mac, cron on a server, or
# a CI runner. It does not depend on GitHub Actions.
#
#   ./scripts/publish.sh            refresh, test, build, publish
#   ./scripts/publish.sh --dry-run  do everything except push
#
# Reads OPENROUTER_API_KEY from the environment or from .env beside this repo.
# Logs to logs/publish-YYYY-MM-DD.log when run with --log.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --log)
      mkdir -p logs
      exec >>"logs/publish-$(date +%F).log" 2>&1
      ;;
  esac
done

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

say "=== Publishing glasgowtheatre.com ==="

# PATH is minimal under launchd, so find node the way a login shell would.
if ! command -v node >/dev/null; then
  for candidate in /opt/homebrew/bin /usr/local/bin; do
    [ -x "$candidate/node" ] && export PATH="$candidate:$PATH"
  done
fi
command -v node >/dev/null || { say "✗ node not found on PATH"; exit 1; }
say "node $(node -v)"

# The API key never lives in the repo; .env is gitignored.
if [ -f .env ]; then
  set -a; . ./.env; set +a
fi
[ -n "${OPENROUTER_API_KEY:-}" ] || say "! OPENROUTER_API_KEY not set — tagging will use the keyword fallback"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  say "✗ on branch '$BRANCH', expected main"
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  say "✗ working tree has uncommitted changes; refusing to publish"
  exit 1
fi

say "Syncing with origin/main"
git pull --ff-only origin main

say "Installing dependencies"
npm ci --silent

# A failed refresh is survivable: the build republishes the last saved
# listings with expired shows removed, exactly as the workflow did.
say "Refreshing listings"
if npm run refresh; then
  say "✓ refresh complete"
else
  say "! refresh failed — building from the last saved listings"
fi

say "Running tests"
npm test

say "Building"
npm run build

say "Checking the built site"
npx playwright test --reporter=line

if [ "$DRY_RUN" = "1" ]; then
  say "(dry run — nothing pushed)"
  git status --short
  exit 0
fi

if git diff --quiet -- data src/images dist; then
  say "Nothing changed; not publishing"
  exit 0
fi

say "Committing refreshed data"
git add data src/images dist
git -c user.name='glasgowtheatre-bot' \
    -c user.email='info@glasgowtheatre.com' \
    commit -m "Refresh venue listings and cached images ($(date +%F))"
git push origin main

# GitHub Pages serves the gh-pages branch, which holds the built site at its
# root. Publish through a temporary worktree so the checkout here is untouched.
say "Publishing dist to gh-pages"
WORKTREE="$(mktemp -d)"
cleanup() { git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT

git fetch origin gh-pages
git worktree add --force "$WORKTREE" gh-pages >/dev/null
rsync -a --delete --exclude='.git' dist/ "$WORKTREE"/
(
  cd "$WORKTREE"
  git add -A
  if git diff --cached --quiet; then
    echo "gh-pages already current"
  else
    git -c user.name='glasgowtheatre-bot' \
        -c user.email='info@glasgowtheatre.com' \
        commit -m "Publish site ($(date +%F))"
    git push origin gh-pages
  fi
)

say "✓ Published"
