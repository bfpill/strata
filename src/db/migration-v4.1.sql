-- Strata v4.1 Migration: experiment-level intent + synth_prob
-- Run: wrangler d1 execute strata-db --remote --file=src/db/migration-v4.1.sql

ALTER TABLE experiments ADD COLUMN intent TEXT;
ALTER TABLE experiments ADD COLUMN synth_prob_json TEXT;
