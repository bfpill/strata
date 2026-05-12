-- Strata D1 Schema v7
-- Run: npm run db:migrate:local (dev) or npm run db:migrate:remote (prod)

CREATE TABLE IF NOT EXISTS experiments (
  experiment_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  "group" TEXT,
  kind TEXT NOT NULL DEFAULT 'single'
    CHECK (kind IN ('single', 'sweep', 'comparison', 'collection')),
  title TEXT NOT NULL,
  summary TEXT,
  tags TEXT, -- JSON array
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'unlisted', 'private')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'tombstoned')),
  intent TEXT,
  synth_prob_json TEXT,              -- JSON: resolved synth_prob (model, task, codes, config)
  notes_markdown TEXT,
  notes_updated_at TEXT,
  notes_updated_by TEXT
);

CREATE TABLE IF NOT EXISTS runs (
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
  hparams_json TEXT,                -- JSON: full hparams dict
  dataset_kinds TEXT,               -- JSON array: top-level zarr group names
  sources_json TEXT,                -- JSON: sources dict (structured refs + raw URIs)
  artifact_layouts_json TEXT,       -- JSON: {label: {param: display_mode}}
  invocations_json TEXT,            -- JSON: [{argv, timestamp, commit, script_uri}, ...]
  UNIQUE (experiment_id, run_index)
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id),
  run_id TEXT REFERENCES runs(run_id),
  artifact_type TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  uri TEXT NOT NULL,
  content_hash TEXT,
  size_bytes INTEGER,
  params_json TEXT NOT NULL DEFAULT '{}',  -- JSON: parameter values for parametrised families (canonical-sorted keys)
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS comments (
  comment_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id),
  author TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS lineage_edges (
  edge_id TEXT PRIMARY KEY,
  src_experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id),
  dst_experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id),
  relation TEXT NOT NULL
    CHECK (relation IN ('derived_from', 'reanalysis_of', 'rerun_of', 'subset_of', 'compares')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS comparison_members (
  comparison_experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id),
  member_experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id),
  member_run_id TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (comparison_experiment_id, member_experiment_id, member_run_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_experiments_slug ON experiments(slug);
CREATE INDEX IF NOT EXISTS idx_experiments_group ON experiments("group");
CREATE INDEX IF NOT EXISTS idx_experiments_kind ON experiments(kind);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_created_at ON experiments(created_at);
CREATE INDEX IF NOT EXISTS idx_runs_experiment_id ON runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_runs_experiment_index ON runs(experiment_id, run_index);
CREATE INDEX IF NOT EXISTS idx_artifacts_experiment_id ON artifacts(experiment_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_unique ON artifacts(run_id, label, params_json);
CREATE INDEX IF NOT EXISTS idx_comments_experiment_id ON comments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_lineage_src ON lineage_edges(src_experiment_id);
CREATE INDEX IF NOT EXISTS idx_lineage_dst ON lineage_edges(dst_experiment_id);
