-- Migration: v5 -> v6
-- Drop manifest_uri and zarr_root_uri (server no longer reads/writes R2).
-- Add sources_json and artifact_layouts_json (formerly in manifest.json).
-- SQLite doesn't support DROP COLUMN before 3.35, so we rebuild.

PRAGMA foreign_keys = OFF;

CREATE TABLE runs_new (
  run_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id),
  run_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'initialised'
    CHECK (status IN ('initialised', 'finalized', 'tombstoned')),
  label TEXT,
  started_at TEXT,
  finished_at TEXT,
  success INTEGER,
  failure_reason TEXT,
  hparams_json TEXT,
  dataset_kinds TEXT,
  sources_json TEXT,
  artifact_layouts_json TEXT,
  UNIQUE (experiment_id, run_index)
);

INSERT INTO runs_new
  (run_id, experiment_id, run_index, status, label,
   started_at, finished_at, success, failure_reason,
   hparams_json, dataset_kinds)
SELECT
  run_id, experiment_id, run_index, status, label,
  started_at, finished_at, success, failure_reason,
  hparams_json, dataset_kinds
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_runs_experiment_id ON runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_runs_experiment_index ON runs(experiment_id, run_index);

PRAGMA foreign_keys = ON;
