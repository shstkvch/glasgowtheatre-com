/**
 * Private stats for the terminal: `theatre analytics`.
 *
 * Token-protected because these are the site's own numbers, not a public
 * dataset. The token lives in the Pages project as ANALYTICS_TOKEN and in the
 * CLI's config; the endpoint compares it in constant time and returns aggregate
 * counts only. No row here can identify a visitor.
 */
import trackCore from "./_lib/track-core.js";

const { londonDay, safeEqual, shiftDay, summarise } = trackCore;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export async function onRequestGet({ request, env }) {
  if (!env.ANALYTICS_TOKEN) {
    return json({ error: "Analytics is not configured" }, 503);
  }
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(token, env.ANALYTICS_TOKEN)) {
    return json({ error: "Unauthorized" }, 401);
  }
  if (!env.DB) return json({ error: "No database bound" }, 503);

  const today = londonDay();
  const monthStart = shiftDay(today, -29);
  const [daily, totals, surfaceDaily, surfaceTotals] = await env.DB.batch([
    env.DB.prepare(
      `SELECT day, show_id, kind, venue_id, title, n
       FROM daily_counts WHERE day >= ?1`,
    ).bind(monthStart),
    env.DB.prepare(
      "SELECT show_id, kind, venue_id, title, n FROM show_totals",
    ),
    env.DB.prepare(
      `SELECT day, show_id, kind, surface, venue_id, title, n
       FROM daily_surface_counts WHERE day >= ?1`,
    ).bind(monthStart),
    env.DB.prepare(
      "SELECT show_id, kind, surface, venue_id, title, n FROM surface_totals",
    ),
  ]);

  const report = summarise({
    daily: daily.results || [],
    totals: totals.results || [],
    surfaceDaily: surfaceDaily.results || [],
    surfaceTotals: surfaceTotals.results || [],
    today,
  });

  return json({ generatedAt: new Date().toISOString(), ...report });
}
