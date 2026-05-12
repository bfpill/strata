-- Migration: v6 -> v7
--
-- Artifacts: coerce NULL label/params_json to non-NULL sentinels so the
-- new UNIQUE(run_id, label, params_json) index actually constrains them,
-- de-duplicate (keeping the newest row per identity), and add an
-- updated_at column so the frontend can cache-bust by version token.
--
-- SQLite/D1: ALTER TABLE ADD COLUMN is fine; UNIQUE constraints on
-- existing tables go via CREATE UNIQUE INDEX (no rebuild needed).

PRAGMA foreign_keys = OFF;

UPDATE artifacts SET label = '' WHERE label IS NULL;
UPDATE artifacts SET params_json = '{}' WHERE params_json IS NULL;

-- De-duplicate: keep the newest row (max created_at) per identity.
-- ROWID is the implicit SQLite primary key alias; we use it as a tiebreaker
-- if two duplicates share the same created_at timestamp.
DELETE FROM artifacts
WHERE rowid NOT IN (
  SELECT MAX(rowid)
  FROM artifacts
  GROUP BY run_id, label, params_json
);

ALTER TABLE artifacts ADD COLUMN updated_at TEXT;
UPDATE artifacts SET updated_at = created_at WHERE updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_unique
  ON artifacts(run_id, label, params_json);

PRAGMA foreign_keys = ON;
