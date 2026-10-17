#!/usr/bin/env python3
"""Print the next few Glasgow shows from an API response on stdin.

    curl -s 'https://glasgowtheatre.com/api/v1/shows?limit=5' \
      | python3 examples/python/shows.py

The interactive version at /api/examples.html runs this same file against a
snapshot of five shows, so the sandbox never needs network access.
"""

import json
import sys


def main() -> int:
    raw = sys.stdin.read().strip()
    if not raw:
        print(
            "No input. Pipe an API response in, for example:\n"
            "  curl -s 'https://glasgowtheatre.com/api/v1/shows-preview.json'"
            " | python3 shows.py",
            file=sys.stderr,
        )
        return 1
    try:
        feed = json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"That was not JSON: {error}", file=sys.stderr)
        return 1

    shows = feed.get("shows", [])
    total = feed.get("total", len(shows))
    print(f"{total} upcoming shows (showing {min(len(shows), 5)})\n")

    for show in shows[:5]:
        pricing = show.get("pricing") or {}
        price = (
            f"from £{pricing['from']}"
            if pricing.get("from") is not None
            else "price at venue"
        )
        run = show.get("run", {})
        venue = show.get("venue", {})
        print(f"{run.get('opens')}  {show.get('title')}")
        print(
            f"          {venue.get('name')} · "
            f"{show.get('artForm')} · {price}"
        )
        print(f"          {show.get('url')}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
