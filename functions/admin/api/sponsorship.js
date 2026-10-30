import core from '../../../src/js/sponsor-core.js';
import { requireAdmin } from '../../_lib/sponsorship-auth.js';
import { state, inventory, settings, metadata, clickReport, json } from '../../_lib/sponsorship-store.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'No database is configured.' }, 503);
  try {
    const config = await settings(env.DB);
    const report = await clickReport(env.DB);
    if (new URL(request.url).searchParams.get('report') === '1') return json({ report });
    try {
      const current = await state(env, request, { force: new URL(request.url).searchParams.get('refresh') === '1' });
      const listings = await metadata(env, request);
      return json({ settings: config, selected: current.selected, checkedAt: current.stock.fetchedAt, report,
        shows: current.stock.feed.shows.map(show => {
          const performances = core.availablePerformances(show);
          return { slug: show.slug, title: show.title, available: performances.length > 0, next: performances[0] || null, listing: performances.length ? core.normalise({ show, performances }, listings, config) : null };
        }),
      });
    } catch {
      // The panel must still allow pausing/scheduling during a venue outage.
      return json({ settings: config, selected: null, checkedAt: null, report, shows: [], warning: 'Theatre 118 availability could not be checked. Public sponsorship is hidden until it can be verified.' });
    }
  } catch (error) { console.error('Sponsorship admin:', error.message); return json({ error: 'Sponsorship storage is unavailable.' }, 503); }
}

export async function onRequestPut({ request, env }) {
  const denied = await requireAdmin(request, env, { write: true });
  if (denied) return denied;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ error: 'Settings are too large.' }, 400);
    let input;
    try { input = JSON.parse(text); } catch { return json({ error: 'Settings must be JSON.' }, 400); }
    const result = core.validateSettings(input);
    if (result.errors.length) return json({ error: result.errors.join(' ') }, 400);
    const value = result.value;
    if (value.enabled && value.mode === 'specific') {
      const stock = await inventory(env.DB);
      if (!core.choose(stock.feed, value)) return json({ error: 'This show has no available upcoming performance. Choose another show or pause the sponsorship.' }, 400);
    }
    const revision = value.revision;
    delete value.revision;
    const updated = await env.DB.prepare(`UPDATE sponsorship_settings SET settings=?1, revision=revision+1, updated_at=?2
      WHERE id='theatre-118' AND revision=?3`).bind(JSON.stringify(value), new Date().toISOString(), revision).run();
    if (updated.meta.changes !== 1) return json({ error: 'These settings changed in another window. Reload before saving.' }, 409);
    return json({ settings: await settings(env.DB) });
  } catch (error) { console.error('Sponsorship save:', error.message); return json({ error: 'Settings could not be saved. Please try again.' }, 503); }
}
