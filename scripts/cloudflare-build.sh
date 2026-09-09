#!/usr/bin/env bash
#
# Build command for Cloudflare Pages.
#
# Set this as the project's build command, with dist/ as the output directory.
# Required environment variables in the Pages project:
#
#   OPENROUTER_API_KEY   tags listings (falls back to keywords without it)
#   RESEND_API_KEY       sends the daily report
#   REPORT_TO            who receives it
#
# Builds run from a fresh checkout each time. That is fine: cached images are
# committed and named by a hash of their source URL, so only genuinely new
# artwork is downloaded, and the tag cache means only new shows are tagged.

set -uo pipefail

say() { echo "--- $*"; }

say "node $(node -v)"

# A failed venue is survivable: the build republishes the last saved listings
# with expired shows removed, which is what the site did under Actions.
say "Refreshing listings"
if npm run refresh; then
  say "Refresh complete"
else
  say "WARNING: refresh failed — building from the last saved listings"
fi

set -e

say "Testing"
npm test

say "Building"
npm run build

# Runs before the deploy, so it compares against the site still live.
say "Reporting new listings"
node scripts/report-new.js

say "Done"
