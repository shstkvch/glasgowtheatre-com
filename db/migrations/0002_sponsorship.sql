CREATE TABLE IF NOT EXISTS sponsorship_settings (
  id TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO sponsorship_settings VALUES (
  'theatre-118',
  '{"enabled":true,"startsOn":"","endsOn":"","home":true,"detail":true,"mode":"next","showSlug":"","description":""}',
  0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
);
CREATE TABLE IF NOT EXISTS sponsorship_feed_cache (
  id TEXT PRIMARY KEY,
  feed TEXT NOT NULL,
  etag TEXT,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_login_attempts (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
