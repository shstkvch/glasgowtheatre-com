const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/0001_surface_counts.sql'), 'utf8');

// Load the actual Pages Functions as ES modules. Their only import is resolved
// explicitly because the site build itself uses CommonJS.
async function loadFunction(file) {
  const core = pathToFileURL(path.join(__dirname, '../functions/_lib/track-core.js')).href;
  const source = fs.readFileSync(path.join(__dirname, '../functions', file), 'utf8')
    .replace('"./_lib/track-core.js"', JSON.stringify(core));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function d1(database) {
  return {
    prepare(sql) {
      let values = [];
      const execute = () => /^\s*SELECT/i.test(sql)
        ? { results: database.prepare(sql).all(...values) }
        : database.prepare(sql).run(...values);
      return {
        bind(...args) { values = args; return this; },
        run: async () => execute(),
        execute,
      };
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.execute());
        database.exec('COMMIT');
        return results;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
}

test('placement migration is additive and safe to rerun on the existing database', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(schema.split('-- Per-placement subsets')[0]);
    database.exec("INSERT INTO show_totals VALUES ('old-show', 'click', 'tron', 'Old show', 17)");
    database.exec(migration);
    database.exec("INSERT INTO surface_totals VALUES ('new-show', 'click', 'sponsored-home', 'theatre-118', 'New show', 2)");
    database.exec(migration);
    assert.equal(database.prepare('SELECT n FROM show_totals').get().n, 17);
    assert.equal(database.prepare('SELECT n FROM surface_totals').get().n, 2);
  } finally { database.close(); }
});

test('actual tracking and report Functions preserve placement counts after raw events expire', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(schema);
  const env = { DB: d1(database), ANALYTICS_TOKEN: 'test-only-token' };
  const { onRequestPost } = await loadFunction('track.js');
  const { onRequestGet } = await loadFunction('analytics.js');
  try {
    for (const surface of ['sponsored-home', 'sponsored-home', 'sponsored-detail', 'card', 'show']) {
      const pending = [];
      const request = new Request('https://example.test/track', {
        method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin' },
        body: JSON.stringify({ kind: surface === 'show' ? 'view' : 'click', show: 'working-it-out', venue: 'theatre-118', title: 'Working it Out', surface, path: surface === 'sponsored-home' ? '/' : '/shows/citizens-othello.html' }),
      });
      const response = await onRequestPost({ request, env, waitUntil: promise => pending.push(promise) });
      assert.equal(response.status, 204);
      await Promise.all(pending);
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM events').get().n, 5);
    assert.equal(database.prepare("SELECT n FROM show_totals WHERE kind = 'click'").get().n, 4);
    assert.equal(database.prepare("SELECT n FROM surface_totals WHERE surface = 'sponsored-home'").get().n, 2);
    database.exec('DELETE FROM events');
    const request = new Request('https://example.test/analytics', { headers: { Authorization: 'Bearer test-only-token' } });
    const response = await onRequestGet({ request, env });
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.totals.all.clicks, 4);
    assert.equal(report.totals.all.views, 1);
    assert.equal(report.sponsored.totals.all.clicks, 3);
    assert.equal(report.sponsored.totals.today.clicks, 3);
    assert.equal(report.surfaces['sponsored-home'].totals.all.clicks, 2);
    assert.equal(report.surfaces['sponsored-detail'].totals.all.clicks, 1);
    assert.equal(report.surfaces.card.totals.all.clicks, 1);
    assert.equal(report.sponsored.shows[0].id, 'working-it-out');
  } finally { database.close(); }
});
