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
