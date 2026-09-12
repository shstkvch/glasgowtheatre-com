#!/usr/bin/env node

/**
 * Daily report of newly listed shows.
 *
 * Compares the site just built in dist/ against the one currently published.
 * The live site is the baseline, so there is no database, no state file and
 * nothing to keep in sync: today's deploy becomes tomorrow's comparison.
 *
 * Emails through Resend on every run, so a silent morning means the job did
 * not run rather than that nothing changed. A day with no new shows still
 * sends a short confirmation carrying the run summary.
 *
 * This never fails the build. A broken report must not stop a deploy.
 *
 * Environment:
 *   RESEND_API_KEY  required to actually send
 *   REPORT_TO       recipient
 *   REPORT_FROM     sender (default onboarding@resend.dev)
 *   SITE_URL        site to compare against (default https://glasgowtheatre.com)
 *   GBP_PER_USD     rate for showing spend in pounds (default 0.79)
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
const BUILT_STATUS = path.join(__dirname, "..", "dist", "data", "status.json");

// OpenRouter bills in dollars; the report reads in pounds. The spend is a
// fraction of a penny a day, so an approximate rate is close enough. Override
// with GBP_PER_USD if it ever drifts far enough to matter.
const GBP_PER_USD = Number(process.env.GBP_PER_USD || 0.79);

// How many out-of-scope listings, and how many keyword-guessed ones, to name
// before summarising the rest.
const EXCLUDED_SHOWN = 8;
const FALLBACK_SHOWN = 8;

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

/**
 * Pounds, to whatever precision actually says something. A tagging run costs
 * well under a penny, so two decimal places would read as free every day.
 */
const money = (usd) => {
  const gbp = (usd || 0) * GBP_PER_USD;
  if (gbp <= 0) return "\u00a30.00";
  if (gbp < 0.01) return `\u00a3${gbp.toFixed(4)}`;
  return `\u00a3${gbp.toFixed(2)}`;
};

/**
 * What tagging spent on this run. The usage file is written by every tag run,
 * but a hard failure leaves the previous run's file in place, so anything
 * older than this run's refresh is reported as not having happened.
 */
function taggingLine(status) {
  const usage = status?.tagging;
  const stale =
    usage && status?.refreshedAt && usage.at < status.refreshedAt;
  if (!usage || stale) return "Tagging: did not run \u2014 \u00a30.00";
  const tokens = usage.totalTokens || 0;
  if (!tokens) return "Tagging: nothing new to tag \u2014 \u00a30.00";
  // Where the model answered about fewer listings than it was asked about,
  // both numbers are given. One number hid a run that classified five of
  // seventeen and guessed at the rest.
  const asked = usage.listingsPending ?? usage.listingsTagged;
  const answered = usage.listingsTagged;
  const count = asked > answered ? `${answered} of ${asked}` : `${answered}`;
  return `Tagging: ${tokens.toLocaleString("en-GB")} tokens for ${count} listing${
    asked === 1 ? "" : "s"
  } \u2014 ${money(usage.costUsd)}`;
}

/**
 * Listings the model was never heard about, which the keyword fallback then
 * guessed at. A guess is not visibly a guess on the site - a gig the keywords
 * cannot place is published as a play - so the morning email has to say which
 * listings are guesses, the way it already says which were left off.
 */
function fallbackLines(status) {
  const fellBack = status?.tagging?.fellBack || [];
  if (!fellBack.length) return [];
  const lines = [
    `Not classified, so keyword-guessed: ${fellBack.length}. Check these.`,
  ];
  for (const item of fellBack.slice(0, FALLBACK_SHOWN)) {
    lines.push(`  \u00b7 ${item.title} \u2014 ${item.venue}`);
  }
  if (fellBack.length > FALLBACK_SHOWN) {
    lines.push(`  \u00b7 \u2026and ${fellBack.length - FALLBACK_SHOWN} more.`);
  }
  return lines;
}

/**
 * What reading the venues' ticket wording spent. Most mornings nothing new
 * has appeared and the answer is nothing, because the reading is cached by
 * the exact words the model saw.
 */
function ticketsLine(status) {
  const usage = status?.tickets;
  const stale = usage && status?.refreshedAt && usage.at < status.refreshedAt;
  if (!usage || stale) return "Ticket prices: did not run \u2014 \u00a30.00";
  const tokens = usage.totalTokens || 0;
  if (!tokens) return "Ticket prices: nothing new to read \u2014 \u00a30.00";
  return `Ticket prices: ${tokens.toLocaleString("en-GB")} tokens for ${usage.listingsRead} listing${
    usage.listingsRead === 1 ? "" : "s"
  } \u2014 ${money(usage.costUsd)}`;
}

/**
 * Scrapes that threw, and structural checks that failed. A canary failing
 * without an error means the page loaded and parsed but no longer looks the
 * way the scraper expects, which is how a venue's redesign shows up: quietly,
 * as fewer listings, unless something says so.
 */
function troubleLines(status) {
  const lines = [];
  for (const [venue, message] of Object.entries(status?.failures || {})) {
    lines.push(`Scrape failed \u2014 ${venue}: ${message}`);
  }
  for (const [venue, checks] of Object.entries(status?.canaries || {})) {
    for (const check of checks) {
      lines.push(`Check failed \u2014 ${venue}: ${check}`);
    }
  }
  return lines;
}

/** The lines that say the job ran properly, in both kinds of email. */
function summaryLines(total, status) {
  const lines = [`${total} shows listed in total.`];
  if (status?.refreshedAt) {
    lines.push(
      `Listings refreshed ${new Date(status.refreshedAt).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        dateStyle: "medium",
        timeStyle: "short",
      })}.`,
    );
  }
  if (status?.retainedVenues?.length) {
    lines.push(
      `Serving saved listings for: ${status.retainedVenues.join(", ")}.`,
    );
  }
  lines.push(taggingLine(status));
  lines.push(ticketsLine(status));

  // On a first run this list is a hundred long, so it is summarised by venue
  // and only a handful are named. The full list is in the build log.
  const excluded = status?.tagging?.excluded || [];
  if (excluded.length) {
    const byVenue = {};
    for (const item of excluded) {
      byVenue[item.venue] = (byVenue[item.venue] || 0) + 1;
    }
    const venues = Object.entries(byVenue)
      .sort((a, b) => b[1] - a[1])
      .map(([venue, count]) => `${venue} ${count}`)
      .join(", ");
    lines.push(`Left off as not theatre: ${excluded.length} (${venues}).`);
    for (const item of excluded.slice(0, EXCLUDED_SHOWN)) {
      lines.push(`  \u00b7 ${item.title} \u2014 ${item.reason}`);
    }
    if (excluded.length > EXCLUDED_SHOWN) {
      lines.push(`  \u00b7 \u2026and ${excluded.length - EXCLUDED_SHOWN} more.`);
    }
  }

  lines.push(...fallbackLines(status));
  lines.push(...troubleLines(status));
  return lines;
}

function emailBody(added, total, status) {
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
  const lines = summaryLines(total, status);
  return {
    subject: `${count} on Glasgow Theatre`,
    text: `${count} added today.\n\n${plain}\n\n${lines.join("\n")}\n\n${SITE}/`,
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;color:#20202c">
<h1 style="font-size:20px;margin:0 0 4px">${count} on Glasgow Theatre</h1>
<p style="color:#595867;font-size:13px;margin:0 0 20px">${escape(lines[0])}</p>
<table style="border-collapse:collapse;width:100%">${rows}</table>
${footer(lines.slice(1))}
<p style="margin:24px 0 0"><a href="${SITE}/" style="color:#303fce;font-size:13px">See what's on ↗</a></p>
</div>`,
  };
}

/** The run summary, small and grey under whatever the email is about. */
const footer = (lines) =>
  `<p style="color:#595867;font-size:12px;margin:24px 0 0;line-height:1.6">${lines
    .map(escape)
    .join("<br>")}</p>`;

/**
 * Sent on a day when nothing new appeared. It exists so that no email means
 * the build did not run, rather than that there was nothing worth saying.
 */
function quietBody(total, status) {
  const lines = summaryLines(total, status);
  const trouble = troubleLines(status);
  return {
    subject: trouble.length
      ? `Glasgow Theatre: ${trouble.length} problem${trouble.length === 1 ? "" : "s"} with the scrape`
      : "Glasgow Theatre: no new shows today",
    text: `${trouble.length ? "The build ran, but something needs looking at." : "No new shows were listed today."}\n\n${lines.join("\n")}\n\n${SITE}/`,
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;color:#20202c">
<h1 style="font-size:20px;margin:0 0 4px">${trouble.length ? escape(`${trouble.length} problem${trouble.length === 1 ? "" : "s"} with the scrape`) : "No new shows today"}</h1>
<p style="color:#595867;font-size:13px;margin:0 0 4px">${escape(lines[0])}</p>
${footer(lines.slice(1))}
<p style="margin:24px 0 0"><a href="${SITE}/" style="color:#303fce;font-size:13px">See what's on \u2197</a></p>
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
  const status = (() => {
    try {
      return JSON.parse(fs.readFileSync(BUILT_STATUS, "utf8"));
    } catch {
      return null;
    }
  })();
  console.log(`\n📮 Comparing ${current.length} built listings against ${SITE}`);

  const previous = await publishedFeed();
  if (!previous) {
    // Still worth an email: the run did happen, and staying quiet is exactly
    // what a build that never fired would look like.
    console.log(
      "  No published feed to compare against. This build becomes the baseline.",
    );
    const message = quietBody(current.length, status);
    message.subject = "Glasgow Theatre: baseline set";
    message.text = `No published feed to compare against, so today's build becomes the baseline.\n\n${message.text}`;
    if (dryRun) {
      console.log(`\n  (dry run) subject: ${message.subject}\n`);
      console.log(message.text);
      return;
    }
    await send(message);
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

  if (!added.length) console.log("  Nothing new.");

  const message = added.length
    ? emailBody(added, current.length, status)
    : quietBody(current.length, status);
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

module.exports = { emailBody, quietBody, summaryLines, taggingLine, ticketsLine, troubleLines, fallbackLines, money, when };
