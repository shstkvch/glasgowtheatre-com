-- Apply before deploying the placement-aware /track and /analytics Functions.
-- Additive and safe to rerun; existing counts are left untouched.
-- Placement history starts when these counters are enabled. No synthetic
-- all-time breakdown is backfilled from the time-limited raw event table.
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
