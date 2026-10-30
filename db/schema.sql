-- Outbound booking clicks and show-page views.
--
-- One row per event rather than a counter so the same table can answer new
-- questions later: which surface, which country, which day. There is no
-- identifier of any kind, so a row cannot be tied to a person or to another
-- row from the same visit.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('click', 'view')),
  show_id TEXT NOT NULL,
  venue_id TEXT,
  title TEXT,
  surface TEXT,
  path TEXT,
  country TEXT
);

CREATE INDEX IF NOT EXISTS events_show_kind_ts ON events (show_id, kind, ts);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

-- The dashboard's read model: one row per day, show and kind. Small enough
-- that polling `theatre analytics` every few seconds never scans the raw
-- table, and a week is a range over a few dozen rows.
CREATE TABLE IF NOT EXISTS daily_counts (
  day TEXT NOT NULL,
  show_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('click', 'view')),
  venue_id TEXT,
  title TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, show_id, kind)
);

CREATE INDEX IF NOT EXISTS daily_counts_day ON daily_counts (day);

-- Lifetime totals, so the all-time column does not scan every day ever.
CREATE TABLE IF NOT EXISTS show_totals (
  show_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('click', 'view')),
  venue_id TEXT,
  title TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (show_id, kind)
);

-- Per-placement subsets of the existing counters. These retain the placement
-- breakdown after raw events expire. No visitor identifier is introduced.
CREATE TABLE IF NOT EXISTS daily_surface_counts (
  day TEXT NOT NULL,
  show_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('click', 'view')),
  surface TEXT NOT NULL,
  venue_id TEXT,
  title TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, show_id, kind, surface)
);

CREATE INDEX IF NOT EXISTS daily_surface_counts_day ON daily_surface_counts (day);

CREATE TABLE IF NOT EXISTS surface_totals (
  show_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('click', 'view')),
  surface TEXT NOT NULL,
  venue_id TEXT,
  title TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (show_id, kind, surface)
);
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
