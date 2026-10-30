const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectSponsoredShow, availablePerformances, matchesSponsor, londonClock } = require('./sponsor-core');
const { filterEvents } = require('../../src/js/listings');
const feed = require('./snapshot.json');
const now = new Date('2026-10-30T12:00:00Z');
const clone = () => structuredClone(feed);

test('current next bookable show comes from the actual API snapshot', () => {
  const selected = selectSponsoredShow(feed, now);
  assert.equal(selected.show.slug, 'working-it-out');
  assert.equal(selected.performances[0].date, '2026-11-16');
});

for (const [name, change] of [
  ['sold out', show => show.performances.forEach(p => p.sold_out = true)],
  ['cancelled', show => show.performances.forEach(p => p.cancelled = true)],
  ['not on sale', show => show.ticketing.on_sale = false],
  ['missing booking URL', show => show.performances.forEach(p => p.booking_url = null)],
  ['unknown sold-out state', show => show.performances.forEach(p => delete p.sold_out)],
  ['external inventory', show => show.ticketing.external_url = 'https://example.com/checkout'],
]) {
  test(`skip a show that is ${name}`, () => {
    const data = clone(); change(data.shows[0]);
    assert.equal(selectSponsoredShow(data, now).show.id, data.shows[1].id);
  });
}

test('one available future sitting is enough despite sold-out or cancelled others', () => {
  const show = clone().shows[1];
  show.performances[0].sold_out = true;
  show.performances[1].cancelled = true;
  assert.equal(availablePerformances(show, now).length, 3);
});

test('sort by the next available sitting, rather than the run start or feed order', () => {
  const data = clone();
  data.shows[0].performances[0].date = '2026-12-20';
  assert.equal(selectSponsoredShow(data, now).show.id, data.shows[1].id);
  data.shows.reverse();
  assert.equal(selectSponsoredShow(data, now).show.slug, 'sleeping-beauty-the-new-republic-of-port-dundas');
});

test('same-day curtain times expire precisely and past performances are excluded', () => {
  const show = clone().shows[0];
  assert.equal(availablePerformances(show, new Date('2026-11-16T19:59:00Z')).length, 1);
  assert.equal(availablePerformances(show, new Date('2026-11-16T20:00:00Z')).length, 0);
  assert.equal(availablePerformances(show, new Date('2026-11-17T00:00:00Z')).length, 0);
});

test('use Glasgow local time in summer and winter', () => {
  assert.deepEqual(londonClock(new Date('2026-07-01T23:30:00Z')), { date: '2026-07-02', time: '00:30' });
  assert.deepEqual(londonClock(new Date('2026-10-30T23:30:00Z')), { date: '2026-10-30', time: '23:30' });
});

test('a same-day sitting with no time is unknown; a future-day sitting is upcoming', () => {
  const show = clone().shows[0]; show.performances[0].time = null;
  assert.equal(availablePerformances(show, now).length, 1);
  assert.equal(availablePerformances(show, new Date('2026-11-16T10:00:00Z')).length, 0);
});

test('nothing is selected when there are no qualifying shows', () => {
  assert.equal(selectSponsoredShow({ shows: [] }, now), null);
  assert.equal(selectSponsoredShow(feed, new Date('2027-01-01T00:00:00Z')), null);
});

test('sponsor follows the site matcher across search, venue, art form and date combinations', () => {
  const selected = selectSponsoredShow(feed, now);
  const listing = { id: 'working', title: selected.show.title, description: selected.show.description, date: '2026-11-16', venueId: 'theatre-118', venue: 'Theatre 118', form: 'scratch', ticketUrl: selected.show.url };
  const matches = filters => matchesSponsor(selected, listing, filters, filterEvents, now);
  assert(matches({}));
  assert(matches({ query: 'poetry', venue: 'theatre-118', form: 'scratch', from: '2026-11-16', to: '2026-11-16' }));
  for (const filters of [{ venue: 'tron' }, { form: 'pantomime' }, { query: 'Othello' }, { from: '2026-11-17' }, { to: '2026-11-15' }, { from: '2026-11-17', to: '2026-11-15' }]) assert.equal(matches(filters), false);
  assert.equal(matchesSponsor(selectSponsoredShow({ shows: [feed.shows[1]] }, now), listing, {}, filterEvents, now), false);
});

test('a run overlapping the selected dates cannot promote only sold-out sittings', () => {
  const data = clone();
  const show = data.shows[1];
  show.performances[0].sold_out = true;
  const candidate = { show, performances: availablePerformances(show, now) };
  const listing = { id: 'panto', title: show.title, date: show.start_date, endDate: show.end_date, ticketUrl: show.url };
  assert.equal(matchesSponsor(candidate, listing, { from: '2026-12-16', to: '2026-12-16' }, filterEvents, now), false);
  assert.equal(matchesSponsor(candidate, listing, { from: '2026-12-17', to: '2026-12-17' }, filterEvents, now), true);
});
