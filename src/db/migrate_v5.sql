-- Migration: status simplification (v4 -> v5)
-- SQLite doesn't support ALTER COLUMN, so we rebuild both tables.

PRAGMA foreign_keys = OFF;

-- Experiments
CREATE TABLE experiments_new (
  experiment_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  "group" TEXT,
  kind TEXT NOT NULL DEFAULT 'single'
    CHECK (kind IN ('single', 'sweep', 'comparison', 'collection')),
  title TEXT NOT NULL,
  summary TEXT,
  tags TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'unlisted', 'private')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'tombstoned')),
  intent TEXT,
  synth_prob_json TEXT,
  notes_markdown TEXT,
  notes_updated_at TEXT,
  notes_updated_by TEXT
);

INSERT INTO experiments_new SELECT
  experiment_id, slug, "group", kind, title, summary, tags,
  created_at, created_by, visibility,
  CASE
    WHEN status = 'tombstoned' THEN 'tombstoned'
    ELSE 'active'
  END,
  intent, synth_prob_json, notes_markdown, notes_updated_at, notes_updated_by
FROM experiments;

DROP TABLE experiments;
ALTER TABLE experiments_new RENAME TO experiments;

-- Runs
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
  manifest_uri TEXT,
  zarr_root_uri TEXT,
  hparams_json TEXT,
  dataset_kinds TEXT,
  UNIQUE (experiment_id, run_index)
);

INSERT INTO runs_new SELECT
  run_id, experiment_id, run_index,
  CASE
    WHEN status = 'tombstoned' THEN 'tombstoned'
    WHEN status IN ('uploaded', 'indexed') THEN 'finalized'
    ELSE 'initialised'
  END,
  label, started_at, finished_at, success, failure_reason,
  manifest_uri, zarr_root_uri, hparams_json, dataset_kinds
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_experiments_slug ON experiments(slug);
CREATE INDEX IF NOT EXISTS idx_experiments_group ON experiments("group");
CREATE INDEX IF NOT EXISTS idx_experiments_kind ON experiments(kind);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_created_at ON experiments(created_at);
CREATE INDEX IF NOT EXISTS idx_runs_experiment_id ON runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_runs_experiment_index ON runs(experiment_id, run_index);

PRAGMA foreign_keys = ON;
