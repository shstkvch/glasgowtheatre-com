/**
 * Validation and aggregation for the analytics endpoint.
 *
 * Kept free of Workers and Node APIs so the build, the Function and `npm test`
 * can all load it. The rules here are the boundary between a public POST and a
 * database write, so they are deliberately narrow: anything unexpected is
 * dropped rather than corrected.
 */
"use strict";

const KINDS = new Set(["click", "view"]);
const SURFACES = new Set(["card", "show-hero", "show-panel", "show", "other"]);
const SHOW_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const VENUE_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const PATH_RE = /^\/[^\u0000-\u001f\u007f?#]{0,159}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const MAX_BODY = 512;

const clean = (value, max) => {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  return text || null;
};

/** The calendar day in Glasgow, so a late click is not counted tomorrow. */
function londonDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDay(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * Turn a beacon body into a row, or null if it is not something the site
 * could have sent. `country` comes from Cloudflare, not the client.
 */
function parseEvent(body, { country = null, now = new Date() } = {}) {
  if (typeof body !== "string" || body.length > MAX_BODY) return null;
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (typeof data.show !== "string" || !SHOW_RE.test(data.show)) return null;
  if (!KINDS.has(data.kind)) return null;
  return {
    ts: now.toISOString(),
    day: londonDay(now),
    kind: data.kind,
    show: data.show,
    venue:
      typeof data.venue === "string" && VENUE_RE.test(data.venue)
        ? data.venue
        : null,
    title: clean(data.title, 200),
    surface: SURFACES.has(data.surface) ? data.surface : "other",
    path: typeof data.path === "string" && PATH_RE.test(data.path)
      ? data.path
      : null,
    country: typeof country === "string" && COUNTRY_RE.test(country)
      ? country
      : null,
  };
}

/** Constant-time comparison, so a wrong token cannot be found a byte at a time. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Merge the daily counters and the lifetime counters into one report.
 *
 * `daily` is one row per day, show and kind; `totals` is one row per show and
 * kind. Summing in JavaScript keeps the dashboard to three small indexed
 * queries however many raw events there are.
 */
function summarise({ daily = [], totals = [], today }) {
  const weekStart = shiftDay(today, -6);
  const monthStart = shiftDay(today, -29);
  const shows = new Map();

  const ensure = (id) => {
    if (!shows.has(id)) {
      shows.set(id, {
        id,
        title: null,
        venue: null,
        clicks: { today: 0, week: 0, month: 0, all: 0 },
        views: { today: 0, week: 0, month: 0, all: 0 },
      });
    }
    return shows.get(id);
  };

  const add = (row, field, window) => {
    const show = ensure(row.show_id);
    if (row.title) show.title = row.title;
    if (row.venue_id) show.venue = row.venue_id;
    show[field][window] += row.n;
  };

  for (const row of totals) {
    if (!KINDS.has(row.kind)) continue;
    add(row, row.kind === "click" ? "clicks" : "views", "all");
  }
  for (const row of daily) {
    if (!KINDS.has(row.kind) || row.day < monthStart) continue;
    const field = row.kind === "click" ? "clicks" : "views";
    add(row, field, "month");
    if (row.day >= weekStart) add(row, field, "week");
    if (row.day === today) add(row, field, "today");
  }

  const list = [...shows.values()].sort(
    (a, b) =>
      b.clicks.week - a.clicks.week ||
      b.clicks.all - a.clicks.all ||
      (a.title || a.id).localeCompare(b.title || b.id),
  );
  const total = (window) =>
    list.reduce(
      (sum, show) => ({
        clicks: sum.clicks + show.clicks[window],
        views: sum.views + show.views[window],
      }),
      { clicks: 0, views: 0 },
    );

  return {
    windows: {
      today,
      week: `${weekStart}..${today}`,
      month: `${monthStart}..${today}`,
    },
    totals: {
      today: total("today"),
      week: total("week"),
      month: total("month"),
      all: total("all"),
    },
    shows: list,
  };
}

module.exports = {
  MAX_BODY,
  londonDay,
  parseEvent,
  safeEqual,
  shiftDay,
  summarise,
};
