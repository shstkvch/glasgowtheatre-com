#!/usr/bin/env node
/**
 * Print the next few Glasgow shows from an API response on stdin.
 *
 *   curl -s 'https://glasgowtheatre.com/api/v1/shows?limit=5' \
 *     | node examples/javascript/shows.js
 *
 * The interactive version at /api/examples.html runs this same file against a
 * snapshot of five shows, so the sandbox never needs network access.
 */
"use strict";

const fs = require("fs");

const raw = fs.readFileSync(0, "utf8").trim();
if (!raw) {
  console.error(
    "No input. Pipe an API response in, for example:\n" +
      "  curl -s 'https://glasgowtheatre.com/api/v1/shows-preview.json' | node shows.js",
  );
  process.exit(1);
}

let feed;
try {
  feed = JSON.parse(raw);
} catch (error) {
  console.error(`That was not JSON: ${error.message}`);
  process.exit(1);
}

const shows = Array.isArray(feed.shows) ? feed.shows : [];
const total = Number.isInteger(feed.total) ? feed.total : shows.length;
console.log(`${total} upcoming shows (showing ${Math.min(shows.length, 5)})\n`);

for (const show of shows.slice(0, 5)) {
  const price =
    show.pricing && show.pricing.from != null
      ? `from £${show.pricing.from}`
      : "price at venue";
  console.log(
    `${show.run.opens}  ${show.title}\n` +
      `          ${show.venue.name} · ${show.artForm} · ${price}\n` +
      `          ${show.url}\n`,
  );
}
