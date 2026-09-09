#!/usr/bin/env node

/**
 * Daily report of newly listed shows.
 *
 * Compares the site just built in dist/ against the one currently published.
 * The live site is the baseline, so there is no database, no state file and
 * nothing to keep in sync: today's deploy becomes tomorrow's comparison.
 *
 * Emails through Resend only when something new appeared. A first run with no
 * published feed yet establishes the baseline silently.
 *
 * This never fails the build. A broken report must not stop a deploy.
 *
 * Environment:
 *   RESEND_API_KEY  required to actually send
 *   REPORT_TO       recipient
 *   REPORT_FROM     sender (default onboarding@resend.dev)
 *   SITE_URL        site to compare against (default https://glasgowtheatre.com)
 *
 * Usage: node scripts/report-new.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");

const SITE = (process.env.SITE_URL || "https://glasgowtheatre.com").replace(
  /\/$/,
  "",
);
const FEED = "/data/events.json";
const BUILT = path.join(__dirname, "..", "dist", "data", "events.json");

const fmtDate = (value) =>
  new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const when = (event) =>
  event.endDate && event.endDate !== event.date
    ? `${fmtDate(event.date)} – ${fmtDate(event.endDate)}`
    : fmtDate(event.date);

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** The published feed, or null when there is nothing to compare against yet. */
async function publishedFeed() {
  try {
    const res = await fetch(SITE + FEED, {
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feed = await res.json();
    return Array.isArray(feed) ? feed : null;
  } catch (err) {
    console.log(`  ! Could not read the published feed: ${err.message}`);
    return null;
  }
}

function emailBody(added, total) {
  const rows = added
    .map(
      (event) => `<tr>
  <td style="padding:12px 16px 12px 0;vertical-align:top">
    <a href="${escape(event.ticketUrl)}" style="color:#303fce;font-weight:600;text-decoration:none">${escape(event.title)}</a>
    <div style="color:#595867;font-size:13px;margin-top:2px">${escape(event.season || event.venue)}${
      event.tags?.length
        ? ` · ${escape(event.tags.slice(0, 3).join(", "))}`
        : ""
    }</div>
  </td>
  <td style="padding:12px 0;vertical-align:top;color:#20202c;font-size:13px;white-space:nowrap">${escape(when(event))}</td>
</tr>`,
    )
    .join("");

  const plain = added
    .map(
      (event) =>
        `- ${event.title} — ${event.season || event.venue}, ${when(event)}\n  ${event.ticketUrl}`,
    )
    .join("\n");

  const count = `${added.length} new show${added.length === 1 ? "" : "s"}`;
  return {
    subject: `${count} on Glasgow Theatre`,
    text: `${count} added today. ${total} listed in total.\n\n${plain}\n\n${SITE}/`,
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;color:#20202c">
<h1 style="font-size:20px;margin:0 0 4px">${count} on Glasgow Theatre</h1>
<p style="color:#595867;font-size:13px;margin:0 0 20px">${total} shows listed in total.</p>
<table style="border-collapse:collapse;width:100%">${rows}</table>
<p style="margin:24px 0 0"><a href="${SITE}/" style="color:#303fce;font-size:13px">See what's on ↗</a></p>
</div>`,
  };
}

async function send(message) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_TO;
  if (!key || !to) {
    console.log("  ! RESEND_API_KEY or REPORT_TO not set — not sending");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.REPORT_FROM || "Glasgow Theatre <onboarding@resend.dev>",
      to: to.split(",").map((address) => address.trim()),
      ...message,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
  console.log(`  ✓ Emailed ${to}`);
  return true;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(BUILT)) {
    console.log("✗ dist/data/events.json is missing — run the build first");
    return;
  }
  const current = JSON.parse(fs.readFileSync(BUILT, "utf8"));
  console.log(`\n📮 Comparing ${current.length} built listings against ${SITE}`);

  const previous = await publishedFeed();
  if (!previous) {
    console.log(
      "  No published feed to compare against. This build becomes the baseline.",
    );
    return;
  }

  const known = new Set(previous.map((event) => event.id));
  const added = current
    .filter((event) => !known.has(event.id))
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`  ${previous.length} previously listed, ${added.length} new`);
  for (const event of added) {
    console.log(`    + ${event.title} — ${event.season || event.venue}`);
  }

  if (!added.length) {
    console.log("  Nothing new; no email sent.");
    return;
  }

  const message = emailBody(added, current.length);
  if (dryRun) {
    console.log(`\n  (dry run) subject: ${message.subject}\n`);
    console.log(message.text);
    return;
  }
  await send(message);
}

if (require.main === module) {
  main().catch((err) => {
    // A failed report must never fail a deploy.
    console.error(`✗ Report failed: ${err.message}`);
    process.exit(0);
  });
}

module.exports = { emailBody, when };
