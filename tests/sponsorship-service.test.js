const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, database } = require('./helpers/pages-module');
const fixture = require('./fixtures/theatre-118-sponsorship.json');
const origin = 'https://example.test';
const password = 'test-only-long-admin-password-not-a-production-secret';
const request = (method, body, extra = {}) => new Request(origin + '/admin/api/session', { method, headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.1', ...extra }, ...(body == null ? {} : { body: JSON.stringify(body) }) });

test('admin session requires the password, rejects forged/expired cookies and enforces same-origin writes', async () => {
  const { db, sqlite } = database();
  const env = { DB: db, SPONSOR_ADMIN_PASSWORD: password };
  const auth = await load('functions/_lib/sponsorship-auth.js');
  try {
    assert.equal((await auth.requireAdmin(request('GET'), env)).status, 401);
    assert.equal((await auth.signIn(request('POST', { password: 'wrong' }), env)).status, 401);
    assert.equal((await auth.signIn(request('POST', { password }, { Origin: 'https://other.test' }), env)).status, 403);
    const response = await auth.signIn(request('POST', { password }), env);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('Set-Cookie');
    assert(cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Strict') && cookie.includes('Path=/admin'));
    const value = cookie.split(';')[0];
    const signed = request('GET', null, { Cookie: value });
    assert(await auth.authenticated(signed, env));
    assert(!await auth.authenticated(request('GET', null, { Cookie: value + 'x' }), env));
    assert.equal(await auth.requireAdmin(request('PUT', {}, { Cookie: value, Origin: 'https://other.test' }), env, { write: true }).then(response => response.status), 403);
    const clock = Date.now;
    try { Date.now = () => clock() + 9 * 3600_000; assert(!await auth.authenticated(signed, env)); } finally { Date.now = clock; }
    assert.equal((await auth.requireAdmin(signed, { DB: db })).status, 503);
    assert(auth.signOut(request('DELETE')).headers.get('Set-Cookie').includes('Max-Age=0'));
  } finally { sqlite.close(); }
});

test('failed admin sign-ins are rate limited without storing the raw address', async () => {
  const { db, sqlite } = database();
  const auth = await load('functions/_lib/sponsorship-auth.js');
  try {
    const env = { DB: db, SPONSOR_ADMIN_PASSWORD: password };
    for (let i = 0; i < 5; i++) assert.equal((await auth.signIn(request('POST', { password: 'wrong' }), env)).status, 401);
    assert.equal((await auth.signIn(request('POST', { password }), env)).status, 429);
    const row = sqlite.prepare('SELECT * FROM admin_login_attempts').get();
    assert(!row.bucket.includes('192.0.2.1'));
    assert.equal(row.attempts, 5);
    assert.equal((await auth.signIn(request('POST', { password }, { 'CF-Connecting-IP': '192.0.2.2' }), env)).status, 200);
  } finally { sqlite.close(); }
});

test('inventory is cached for five minutes and revalidated with its ETag', async () => {
  const { db, sqlite } = database();
  const store = await load('functions/_lib/sponsorship-store.js');
  try {
    let calls = 0;
    const initial = async () => { calls++; return new Response(JSON.stringify(fixture), { headers: { ETag: '"feed-v1"' } }); };
    await store.inventory(db, { now: 1_000_000, fetcher: initial });
    await store.inventory(db, { now: 1_100_000, fetcher: initial });
    assert.equal(calls, 1);
    const validated = await store.inventory(db, { now: 1_400_000, fetcher: async (url, options) => {
      assert.equal(options.headers['If-None-Match'], '"feed-v1"');
      return new Response(null, { status: 304 });
    } });
    assert.equal(validated.fetchedAt, 1_400_000);
    assert.equal(validated.feed.shows.length, 2);
  } finally { sqlite.close(); }
});

test('all feed pages are fetched before selection and stale inventory is never served on failure', async () => {
  const { db, sqlite } = database();
  const store = await load('functions/_lib/sponsorship-store.js');
  try {
    const urls = [];
    const fetcher = async url => { urls.push(url); const page = new URL(url).searchParams.get('page'); return new Response(JSON.stringify({ shows: [fixture.shows[page === '1' ? 1 : 0]], meta: { has_more: page === '1' } })); };
    const result = await store.inventory(db, { now: 1_000_000, fetcher });
    assert.equal(urls.length, 2);
    assert.equal(result.feed.shows.length, 2);
    assert.equal(sqlite.prepare('SELECT etag FROM sponsorship_feed_cache').get().etag, null);
    await assert.rejects(() => store.inventory(db, { now: 2_000_000, fetcher: async () => new Response('down', { status: 503 }) }), /503/);
    assert.equal(sqlite.prepare('SELECT fetched_at FROM sponsorship_feed_cache').get().fetched_at, 1_000_000);
  } finally { sqlite.close(); }
});
