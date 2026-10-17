#!/usr/bin/env bash
#
# Run every example against the live API (or another base URL).
#
#   ./examples/run.sh
#   ./examples/run.sh http://127.0.0.1:8000/api/v1
#   API_BASE=http://127.0.0.1:8000/api/v1 ./examples/run.sh
#
# Each program reads the API response from stdin. The shell does the fetching,
# which is exactly what the browser playground does with a five-show snapshot.
set -euo pipefail

BASE="${1:-${API_BASE:-https://glasgowtheatre.com/api/v1}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

command -v curl >/dev/null 2>&1 || {
  echo "curl is required to run the examples." >&2
  exit 1
}

say "JavaScript (Node)"
if command -v node >/dev/null 2>&1; then
  curl -fsS "$BASE/shows-preview.json" | node "$ROOT/javascript/shows.js"
else
  echo "node not found - skipped"
fi

say "Python"
if command -v python3 >/dev/null 2>&1; then
  curl -fsS "$BASE/shows-preview.json" | python3 "$ROOT/python/shows.py"
else
  echo "python3 not found - skipped"
fi

say "PHP"
if command -v php >/dev/null 2>&1; then
  curl -fsS "$BASE/shows-preview.json" | php "$ROOT/php/shows.php"
else
  echo "php not found - skipped"
fi

say "C"
if command -v cc >/dev/null 2>&1; then
  cc -O2 -std=c11 -o "$TMP/shows" "$ROOT/c/shows.c"
  curl -fsS "$BASE/shows-preview.txt" | "$TMP/shows"
else
  echo "cc not found - skipped"
fi

say "Go"
if command -v go >/dev/null 2>&1; then
  curl -fsS "$BASE/shows-preview.json" | (cd "$ROOT/go" && go run .)
else
  echo "go not found - skipped"
fi

say "Done"
echo "Run one example on its own with curl | <runtime>, for example:"
echo "  curl -s '$BASE/shows?limit=5' | node $ROOT/javascript/shows.js"
