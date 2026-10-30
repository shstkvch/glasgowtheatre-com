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
    assert(html.includes('Paid placement by Theatre 118'));
  }
  assert.equal(core.safeUrl('javascript:alert(1)'), null);
  assert.equal(core.safeUrl('https://theatre118.com.evil.test/show'), null);
  assert.equal(core.safeUrl('https://user:secret@theatre118.com/show'), null);
});
