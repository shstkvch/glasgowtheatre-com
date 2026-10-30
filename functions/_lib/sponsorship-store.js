import core from '../../src/js/sponsor-core.js';
import trackCore from './track-core.js';

export const FEED_TTL = 300_000;
const FEED_URL = 'https://theatre118.com/api/v1/shows';

export async function settings(db) {
  const row = await db.prepare("SELECT settings, revision, updated_at FROM sponsorship_settings WHERE id = 'theatre-118'").first();
  if (!row) throw new Error('Sponsorship database migration is missing');
  return { ...JSON.parse(row.settings), revision: row.revision, updatedAt: row.updated_at };
}

export async function inventory(db, { now = Date.now(), force = false, fetcher = fetch } = {}) {
  const cached = await db.prepare("SELECT feed, etag, fetched_at FROM sponsorship_feed_cache WHERE id = 'theatre-118'").first();
  if (!force && cached && now - cached.fetched_at >= 0 && now - cached.fetched_at < FEED_TTL) return { feed: JSON.parse(cached.feed), fetchedAt: cached.fetched_at };
  const shows = [];
  let first;
  let etag;
  for (let page = 1; page <= 20; page++) {
    const response = await fetcher(`${FEED_URL}?per_page=100&page=${page}`, {
      headers: { Accept: 'application/json', ...(page === 1 && cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
      signal: AbortSignal.timeout(6000), redirect: 'manual',
    });
    if (page === 1 && response.status === 304 && cached) {
      await db.prepare("UPDATE sponsorship_feed_cache SET fetched_at = ?1 WHERE id = 'theatre-118'").bind(now).run();
      return { feed: JSON.parse(cached.feed), fetchedAt: now };
    }
    if (!response.ok) throw new Error(`Theatre 118 API returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.shows)) throw new Error('Theatre 118 API returned no show list');
    if (page === 1) { first = data; etag = response.headers.get('ETag'); }
    shows.push(...data.shows);
    if (!data.meta?.has_more) break;
    if (page === 20) throw new Error('Theatre 118 feed could not be fetched completely');
  }
  const feed = { venue: first.venue, generated_at: first.generated_at, shows };
  // An ETag for page one cannot validate later pages. Only reuse it for a
  // complete single-page response, otherwise refetch every page at expiry.
  if (first.meta?.has_more) etag = null;
  await db.prepare(`INSERT INTO sponsorship_feed_cache (id, feed, etag, fetched_at) VALUES ('theatre-118', ?1, ?2, ?3)
    ON CONFLICT(id) DO UPDATE SET feed=excluded.feed, etag=excluded.etag, fetched_at=excluded.fetched_at`).bind(JSON.stringify(feed), etag, now).run();
  return { feed, fetchedAt: now };
}

export async function metadata(env, request) {
  const response = await env.ASSETS.fetch(new Request(new URL('/data/sponsor-listings.json', request.url)));
  if (!response.ok) return {};
  return response.json();
}

export async function state(env, request, { force = false } = {}) {
  const config = await settings(env.DB);
  const [stock, listings] = await Promise.all([inventory(env.DB, { force }), metadata(env, request)]);
  const now = new Date();
  const candidate = core.choose(stock.feed, config, now);
  const selected = candidate ? core.normalise(candidate, listings, config) : null;
  const random = core.choose(stock.feed, { ...config, mode: 'random' }, now);
  const randomSelection = random ? { listing: core.normalise(random, listings, config), windowDays: random.windowDays } : null;
  return { settings: config, stock, selected, randomSelection };
}

export async function clickReport(db) {
  const today = trackCore.londonDay();
  const [daily, totals] = await db.batch([
    db.prepare(`SELECT day, show_id, kind, surface, venue_id, title, n FROM daily_surface_counts
      WHERE day >= ?1 AND surface IN ('sponsored-home', 'sponsored-detail')`).bind(trackCore.shiftDay(today, -29)),
    db.prepare("SELECT show_id, kind, surface, venue_id, title, n FROM surface_totals WHERE surface IN ('sponsored-home', 'sponsored-detail')"),
  ]);
  return trackCore.summarise({ today, daily: daily.results || [], totals: totals.results || [], surfaceDaily: daily.results || [], surfaceTotals: totals.results || [] });
}

export function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
