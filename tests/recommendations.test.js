const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommend } = require('../scripts/recommendations');
const event = (id, extra = {}) => ({ id, title: id, date: '2026-11-10', ticketUrl: `https://example.com/${id}`, ...extra });
const current = event('host', { form: 'play', venueId: 'citizens', venue: 'Citizens Theatre', description: 'Jealousy secrets betrayal', tags: ['play', 'drama'] });
const options = { today: '2026-11-02' };

test('same art form and venue outrank an unrelated show', () => {
  const candidates = [event('unrelated', { form: 'music' }), event('same-venue', { form: 'music', venueId: 'citizens' }), event('same-form', { form: 'play' }), event('both', { form: 'play', venueId: 'citizens' })];
  assert.deepEqual(recommend(current, candidates, { ...options, limit: 4 }).map(r => r.event.id), ['both', 'same-form', 'same-venue', 'unrelated']);
});
test('shared subject words strengthen otherwise equal matches', () => {
  const results = recommend(current, [event('unrelated', { form: 'play' }), event('related', { form: 'play', description: 'Jealousy secrets betrayal' })], options);
  assert.equal(results[0].event.id, 'related');
  assert(results[0].sharedKeywords.includes('betrayal'));
});
test('shared tags strengthen otherwise equal matches', () => {
  const results = recommend(current, [event('a', { form: 'play' }), event('b', { form: 'play', tags: ['drama'] })], options);
  assert.equal(results[0].event.id, 'b');
});
test('exclude self, past shows, the sponsor and duplicate destinations', () => {
  const candidates = [current, event('old', { endDate: '2026-11-01' }), event('sponsor'), event('duplicate-host', { ticketUrl: current.ticketUrl + '/' }), event('one'), event('duplicate-one', { ticketUrl: 'https://example.com/one/' }), event('no-url', { ticketUrl: '' }), event('second', { id: 'one' })];
  assert.deepEqual(recommend(current, candidates, { ...options, excludeUrls: ['https://example.com/sponsor/'] }).map(r => r.event.id), ['one']);
});
test('include a run that began earlier but is still playing', () => {
  assert.equal(recommend(current, [event('ongoing', { date: '2026-10-15', endDate: '2026-11-02' })], options).length, 1);
});
test('ranking is deterministic, capped at three and handles sparse data', () => {
  const candidates = ['d', 'b', 'a', 'c'].map(id => event(id));
  assert.deepEqual(recommend(event('host'), candidates, options).map(r => r.event.id), ['a', 'b', 'c']);
  assert.deepEqual(recommend(event('host'), [], options), []);
});
