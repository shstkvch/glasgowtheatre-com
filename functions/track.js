/**
 * Records one outbound click or show-page view.
 *
 * The page keeps its direct booking link; this receives a beacon alongside the
 * navigation. The write happens in `waitUntil`, so a slow database never holds
 * up a ticket. `track-core` owns the validation, and `ANALYTICS_TOKEN` is not
 * needed here: the endpoint is write-only and accepts nothing but counters.
 */
import trackCore from "./_lib/track-core.js";

const { parseEvent } = trackCore;

// The policy promises raw rows are reduced to totals after 13 months. The
// counters keep the history; the raw table only needs to answer recent
// questions. One isolate sweeps at most once a day, and the delete is indexed.
const RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
let lastSweep = 0;

function sweep(env, waitUntil, now) {
  if (now.getTime() - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now.getTime();
  const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
  waitUntil(
    env.DB.prepare("DELETE FROM events WHERE ts < ?1")
      .bind(cutoff)
      .run()
      .catch(() => {}),
  );
}

const noContent = () =>
  new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });

export async function onRequestPost({ request, env, waitUntil }) {
  // Browsers send this; a cross-site POST is not a click on our links.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") {
    return new Response(null, { status: 403 });
  }
  if (!env.DB) return new Response(null, { status: 503 });

  sweep(env, waitUntil, new Date());

  const row = parseEvent(await request.text(), {
    country: request.cf?.country ?? null,
  });
  if (!row) return new Response(null, { status: 400 });

  waitUntil(
    env.DB.batch([
      env.DB.prepare(
        `INSERT INTO events (ts, kind, show_id, venue_id, title, surface, path, country)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        row.ts,
        row.kind,
        row.show,
        row.venue,
        row.title,
        row.surface,
        row.path,
        row.country,
      ),
      env.DB.prepare(
        `INSERT INTO daily_counts (day, show_id, kind, venue_id, title, n)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT(day, show_id, kind) DO UPDATE SET
           n = n + 1,
           venue_id = COALESCE(excluded.venue_id, venue_id),
           title = COALESCE(excluded.title, title)`,
      ).bind(row.day, row.show, row.kind, row.venue, row.title),
      env.DB.prepare(
        `INSERT INTO show_totals (show_id, kind, venue_id, title, n)
         VALUES (?1, ?2, ?3, ?4, 1)
         ON CONFLICT(show_id, kind) DO UPDATE SET
           n = n + 1,
           venue_id = COALESCE(excluded.venue_id, venue_id),
           title = COALESCE(excluded.title, title)`,
      ).bind(row.show, row.kind, row.venue, row.title),
      env.DB.prepare(
        `INSERT INTO daily_surface_counts (day, show_id, kind, surface, venue_id, title, n)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)
         ON CONFLICT(day, show_id, kind, surface) DO UPDATE SET
           n = n + 1,
           venue_id = COALESCE(excluded.venue_id, venue_id),
           title = COALESCE(excluded.title, title)`,
      ).bind(row.day, row.show, row.kind, row.surface, row.venue, row.title),
      env.DB.prepare(
        `INSERT INTO surface_totals (show_id, kind, surface, venue_id, title, n)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT(show_id, kind, surface) DO UPDATE SET
           n = n + 1,
           venue_id = COALESCE(excluded.venue_id, venue_id),
           title = COALESCE(excluded.title, title)`,
      ).bind(row.show, row.kind, row.surface, row.venue, row.title),
    ]).catch(() => {}),
  );

  return noContent();
}
