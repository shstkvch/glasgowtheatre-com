import { json } from './sponsorship-store.js';

const COOKIE = 'gt_sponsor_admin';
const TTL = 8 * 60 * 60;
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const equal = (a, b) => { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i]; return result === 0; };
const configured = env => typeof env.SPONSOR_ADMIN_PASSWORD === 'string' && env.SPONSOR_ADMIN_PASSWORD.length >= 20;
const key = env => crypto.subtle.importKey('raw', new TextEncoder().encode('sponsor-session-v1:' + env.SPONSOR_ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const signature = async (value, env) => encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(value))));

export function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin && !['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site'));
}

export async function authenticated(request, env) {
  if (!configured(env)) return false;
  const token = (request.headers.get('Cookie') || '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!token || token.length > 300) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return false;
  const expiry = Number(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (expiry <= now || expiry > now + TTL) return false;
  return equal(new TextEncoder().encode(parts[3]), new TextEncoder().encode(await signature(parts.slice(0, 3).join('.'), env)));
}

export async function requireAdmin(request, env, { write = false } = {}) {
  if (!configured(env)) return json({ error: 'Admin sign-in is not configured.' }, 503);
  if (write && !sameOrigin(request)) return json({ error: 'Use the admin panel on this site.' }, 403);
  if (!await authenticated(request, env)) return json({ error: 'Sign in to manage sponsorships.' }, 401);
  return null;
}

function cookie(request, value, age) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
}

export async function signIn(request, env) {
  if (!configured(env) || !env.DB) return json({ error: 'Admin sign-in is not configured.' }, 503);
  if (!sameOrigin(request)) return json({ error: 'Use the admin panel on this site.' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const bucket = encode(await digest(env.SPONSOR_ADMIN_PASSWORD + ':' + (request.headers.get('CF-Connecting-IP') || 'local')));
  const record = await env.DB.prepare('SELECT attempts, window_start FROM admin_login_attempts WHERE bucket = ?1').bind(bucket).first();
  if (record && record.window_start > now - 900 && record.attempts >= 5) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429, { 'Retry-After': '900' });
  // Count before checking the password, so parallel attempts cannot all pass
  // the same old counter. The secret is long and generated, not a human word.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO admin_login_attempts (bucket, window_start, attempts) VALUES (?1, ?2, 1)
      ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN window_start <= ?3 THEN 1 ELSE attempts+1 END,
      window_start=CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END`).bind(bucket, now, now - 900),
    env.DB.prepare('DELETE FROM admin_login_attempts WHERE window_start < ?1').bind(now - 86400),
  ]);
  let data;
  try { const body = await request.text(); if (body.length > 2048) return json({ error: 'Password is too long.' }, 400); data = JSON.parse(body); }
  catch { return json({ error: 'Enter your admin password.' }, 400); }
  if (typeof data?.password !== 'string' || !equal(await digest(data.password), await digest(env.SPONSOR_ADMIN_PASSWORD))) return json({ error: 'Password not recognised.' }, 401);
  await env.DB.prepare('DELETE FROM admin_login_attempts WHERE bucket = ?1').bind(bucket).run();
  const value = `v1.${now + TTL}.${encode(crypto.getRandomValues(new Uint8Array(18)))}`;
  return json({ authenticated: true }, 200, { 'Set-Cookie': cookie(request, `${value}.${await signature(value, env)}`, TTL) });
}

export function signOut(request) {
  if (!sameOrigin(request)) return json({ error: 'Use the admin panel on this site.' }, 403);
  return json({ authenticated: false }, 200, { 'Set-Cookie': cookie(request, '', 0) });
}
