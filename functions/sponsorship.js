import core from '../src/js/sponsor-core.js';
import { settings, inventory, metadata, FEED_TTL, json } from './_lib/sponsorship-store.js';

export async function onRequestGet({ request, env }) {
  const placement = new URL(request.url).searchParams.get('placement');
  if (!['home', 'detail'].includes(placement)) return json({ error: 'Choose home or detail placement' }, 400);
  if (!env.DB) return json({ sponsor: null }, 503);
  try {
    const config = await settings(env.DB);
    if (!core.isActive(config, placement)) return json({ sponsor: null });
    const [stock, listings] = await Promise.all([inventory(env.DB), metadata(env, request)]);
    const candidate = core.choose(stock.feed, config);
    const sponsor = candidate ? core.normalise(candidate, listings, config) : null;
    return json({ sponsor, expiresAt: stock.fetchedAt + FEED_TTL, endsOn: config.endsOn });
  } catch (error) {
    console.error('Sponsorship unavailable:', error.message);
    // Never advertise stale inventory when the feed cannot be verified.
    return json({ sponsor: null }, 503);
  }
}
