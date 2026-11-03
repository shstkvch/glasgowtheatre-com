const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/js/sponsor-core');
const { filterEvents } = require('../src/js/listings');
const feed = require('./fixtures/theatre-118-sponsorship.json');
const now = new Date('2026-10-30T12:00:00Z');
const settings = { ...core.DEFAULTS };

test('sponsorship chooses the next bookable sitting and can pin an eligible show', () => {
  assert.equal(core.choose(feed, settings, now).show.slug, 'working-it-out');
  assert.equal(core.choose(feed, { ...settings, mode: 'specific', showSlug: feed.shows[1].slug }, now).show.id, feed.shows[1].id);
  assert.equal(core.choose(feed, { ...settings, mode: 'specific', showSlug: 'missing' }, now), null);
  const soldOut = structuredClone(feed);
  soldOut.shows[0].performances[0].sold_out = true;
  assert.equal(core.choose(soldOut, settings, now).show.id, soldOut.shows[1].id);
  assert.equal(core.choose(soldOut, { ...settings, mode: 'specific', showSlug: 'working-it-out' }, now), null);
});

test('sponsorship ignores cancelled, unknown, expired and not-on-sale inventory', () => {
  for (const change of [show => show.performances[0].cancelled = true, show => delete show.performances[0].sold_out, show => show.ticketing.on_sale = false, show => show.performances[0].booking_url = null]) {
    const data = structuredClone(feed); change(data.shows[0]);
    assert.equal(core.choose(data, settings, now).show.id, data.shows[1].id);
  }
  assert.equal(core.choose(feed, settings, new Date('2027-01-01')), null);
  assert.equal(core.availablePerformances(feed.shows[0], new Date('2026-11-16T20:00:00Z')).length, 0);
});

function showIn(days, id, extraPerformances = []) {
  const show = structuredClone(feed.shows[0]);
  show.id = id;
  show.slug = `show-${id}`;
  const date = new Date('2026-10-30T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  show.performances = [{ ...show.performances[0], date: date.toISOString().slice(0, 10) }, ...extraPerformances];
  return show;
}

test('random mode draws shows equally from the first nonempty window, including day 30', () => {
  const random = { ...settings, mode: 'random' };
  const first = showIn(1, 'a');
  const boundary = showIn(30, 'b');
  boundary.performances.push(...Array.from({ length: 10 }, () => ({ ...boundary.performances[0] })));
  const data = { shows: [showIn(31, 'c'), boundary, first] };
  const low = core.choose(data, random, now, () => 0);
  const high = core.choose(data, random, now, () => 0.99999);
  assert.equal(low.show.id, 'a');
  assert.equal(high.show.id, 'b');
  assert.equal(high.windowDays, 30);
  // A later sitting does not exclude a show with an earlier available one.
  assert.equal(core.choose({ shows: [showIn(200, 'a', first.performances)] }, random, now).windowDays, 30);
});

test('random mode keeps doubling beyond 240 days and ignores unavailable nearer performances', () => {
  for (const [days, expected] of [[30, 30], [31, 60], [60, 60], [61, 120], [120, 120], [121, 240], [240, 240], [241, 480], [961, 1920]]) {
    const sold = showIn(1, 'sold'); sold.performances[0].sold_out = true;
    const cancelled = showIn(2, 'cancelled'); cancelled.performances[0].cancelled = true;
    const offsale = showIn(3, 'offsale'); offsale.ticketing.on_sale = false;
    const unknown = showIn(4, 'unknown'); delete unknown.performances[0].sold_out;
    const data = { shows: [sold, cancelled, offsale, unknown, showIn(-1, 'past'), showIn(days, 'eligible'), showIn(expected + 1, 'later')] };
    const selected = core.choose(data, { ...settings, mode: 'random' }, now, () => 0.999);
    assert.equal(selected.show.id, 'eligible', `day ${days}`);
    assert.equal(selected.windowDays, expected, `day ${days}`);
  }
  assert.equal(core.choose({ shows: [] }, { ...settings, mode: 'random' }, now), null);
  assert.equal(core.choose({ shows: [showIn(-1, 'past')] }, { ...settings, mode: 'random' }, now), null);
});

test('random daily draw is stable across requests and feed order, with Glasgow calendar windows', () => {
  const data = { shows: Array.from({ length: 20 }, (_, index) => showIn(5, String(index))) };
  const random = { ...settings, mode: 'random' };
  const chosen = core.choose(data, random, now).show.id;
  assert.equal(core.choose({ shows: [...data.shows].reverse() }, random, new Date('2026-10-30T23:59:00Z')).show.id, chosen);
  const draws = new Set(Array.from({ length: 4 }, (_, day) => core.choose(data, random, new Date(`2026-10-${30 - day}T12:00:00Z`)).show.id));
  assert(draws.size > 1);
  // The Glasgow day is already 2 July; 1 August is exactly 30 calendar days away.
  const summer = showIn(1, 'summer'); summer.performances[0].date = '2026-08-01';
  assert.equal(core.choose({ shows: [summer] }, random, new Date('2026-07-01T23:30:00Z')).windowDays, 30);
  const expired = showIn(0, 'ended'); expired.performances[0].time = '11:00';
  assert.equal(core.choose({ shows: [expired] }, random, now), null);
  assert.deepEqual(core.validateSettings({ ...random, showSlug: 'ignored' }).value, { ...random, showSlug: '' });
});

test('scheduling uses Glasgow days, includes the end date and respects placement switches', () => {
  assert(core.isActive({ ...settings, startsOn: '2026-10-30', endsOn: '2026-10-30' }, 'home', now));
  assert(!core.isActive({ ...settings, startsOn: '2026-10-31' }, 'home', now));
  assert(!core.isActive({ ...settings, endsOn: '2026-10-29' }, 'home', now));
  assert(!core.isActive({ ...settings, home: false }, 'home', now));
  assert(!core.isActive({ ...settings, enabled: false }, 'detail', now));
  assert.equal(core.londonClock(new Date('2026-07-01T23:30:00Z')).date, '2026-07-02');
});

test('settings reject malformed and contradictory values without throwing', () => {
  assert.deepEqual(core.validateSettings(settings).errors, []);
  for (const change of [{ enabled: 'yes' }, { startsOn: '2026-99-99' }, { startsOn: '2026-02-30' }, { startsOn: '2026-11-01', endsOn: '2026-10-30' }, { home: false, detail: false }, { mode: 'specific', showSlug: '' }, { description: 'x'.repeat(281) }, { revision: -1 }]) assert(core.validateSettings({ ...settings, ...change }).errors.length, JSON.stringify(change));
  for (const value of [null, [], 'settings']) assert(core.validateSettings(value).errors.length);
});

test('normalisation uses current API content, a stable local ID and the scratch category', () => {
  const candidate = core.choose(feed, settings, now);
  const listing = core.normalise(candidate, { [candidate.show.url]: { id: 'stable-id', form: 'scratch', formLabel: 'Scratch / new material', tags: ['scratch'] } }, settings);
  assert.equal(listing.id, 'stable-id');
  assert.equal(listing.title, 'Working it Out - November 2026');
  assert.equal(listing.form, 'scratch');
  assert.equal(listing.detailUrl, '/shows/stable-id.html');
  assert.equal(listing.price, 300);
  assert.equal(listing.fee, 150);
  assert(listing.image.startsWith('/sponsor-image?path='));
  assert(core.matchesSponsor(candidate, listing, { form: 'scratch', query: 'poetry', from: '2026-11-16', to: '2026-11-16' }, filterEvents, now));
  assert(!core.matchesSponsor(candidate, listing, { form: 'cabaret' }, filterEvents, now));
});

test('renderer escapes editorial copy and preserves separate placement attributes', () => {
  const candidate = core.choose(feed, settings, now);
  const listing = core.normalise(candidate, {}, { ...settings, description: '<img onerror="bad()"> & more' });
  for (const placement of ['home', 'detail']) {
    const html = core.renderSponsor(listing, placement);
    assert(html.includes(`data-track-surface="sponsored-${placement}"`));
    assert(html.includes('&lt;img onerror=&quot;bad()&quot;&gt; &amp; more'));
    assert(!html.includes('<img onerror='));
    assert(html.includes('>Sponsored</span>'));
    assert(html.includes('event-card highlighted-show'));
    assert(html.includes('<h3'));
  }
  assert.equal(core.safeUrl('javascript:alert(1)'), null);
  assert.equal(core.safeUrl('https://theatre118.com.evil.test/show'), null);
  assert.equal(core.safeUrl('https://user:secret@theatre118.com/show'), null);
});


test('sponsored cards use local details only for existing listings and retain outbound attribution', () => {
  const candidate = core.choose(feed, settings, now);
  const external = core.normalise(candidate, {}, settings);
  assert.equal(external.detailUrl, null);
  assert.equal((core.renderSponsor(external, 'home').match(/data-track-surface="sponsored-home"/g) || []).length, 4);
  const local = core.normalise(candidate, { [candidate.show.url.replace(/\/$/, '')]: { id: 'theatre-118-existing' } }, settings);
  const html = core.renderSponsor(local, 'detail');
  assert.equal((html.match(/data-track-surface="sponsored-detail"/g) || []).length, 1);
  assert(html.includes('href="/shows/theatre-118-existing.html"'));
});
