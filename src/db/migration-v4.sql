-- Strata v4 Migration
-- Run: wrangler d1 execute strata-db --remote --file=src/db/migration-v4.sql
--
-- Dead columns from v3 (project, primary_run_id, manifest_schema_version,
-- run_kind, payload_profile, synthesis_problem_id, role) are intentionally
-- left in place — SQLite does not support DROP COLUMN cleanly on D1.

-- 1. Add new columns to experiments (safe if already exist — D1 errors are non-fatal per statement)
ALTER TABLE experiments ADD COLUMN slug TEXT;
ALTER TABLE experiments ADD COLUMN "group" TEXT;

-- 2. Add new columns to runs
-- Using DEFAULT instead of NOT NULL to avoid conflict with existing rows.
-- Status defaults to 'indexed' since all existing runs are finalized.
ALTER TABLE runs ADD COLUMN run_index INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN status TEXT DEFAULT 'indexed';
ALTER TABLE runs ADD COLUMN label TEXT;
ALTER TABLE runs ADD COLUMN hparams_json TEXT;
ALTER TABLE runs ADD COLUMN dataset_kinds TEXT;

-- 3. Backfill run_index = 0 for all existing runs
UPDATE runs SET run_index = 0 WHERE run_index IS NULL;

-- 4. Backfill run status for existing finalized runs
UPDATE runs SET status = 'indexed' WHERE status IS NULL AND success = 1;
UPDATE runs SET status = 'draft' WHERE status IS NULL;

-- 5. Copy project -> group where non-null
UPDATE experiments SET "group" = project WHERE project IS NOT NULL AND "group" IS NULL;

-- 6. Drop old search_index (replaced by hparams_json + dataset_kinds on runs)
DROP TABLE IF EXISTS search_index;

-- 7. Drop old indexes before recreating as unique
DROP INDEX IF EXISTS idx_experiments_slug;
DROP INDEX IF EXISTS idx_runs_experiment_index;

-- 8. Create new indexes
CREATE UNIQUE INDEX idx_experiments_slug ON experiments(slug);
CREATE INDEX IF NOT EXISTS idx_experiments_group ON experiments("group");
CREATE UNIQUE INDEX idx_runs_experiment_index ON runs(experiment_id, run_index);

-- NOTE: Slug backfill for existing experiments must be done via a script
-- (see backfill-slugs.ts) since D1 SQL lacks good random string generation.
-- After backfilling, slugs will be non-null for all experiments.
