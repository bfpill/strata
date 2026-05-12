-- Backfill slugs for existing experiments
-- Generated from titles, with 4-char random suffixes appended after migration.
-- Run AFTER migration-v4.sql.
--
-- Strategy: use experiment_id last 4 chars (lowercase) as the uid suffix.
-- This is deterministic and unique since ULIDs are unique.

-- Tombstoned experiments (test data) — prefix with "test-"
UPDATE experiments SET slug = 'test-first-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJXPVXYMEVQCHY6E9QZD7N48';
UPDATE experiments SET slug = 'test-client-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJXQ7Y61BRPK427A75H1VX6A';
UPDATE experiments SET slug = 'test-e2e-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJXRBWGGTNSX1RP4FQ7Y9SR1';
UPDATE experiments SET slug = 'test-detecta0-sus-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJXS3WVKQMJP0ZSTWTW0R88Z';

-- DetectA(0) susceptibility experiments
UPDATE experiments SET slug = 'detecta0-sus-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJXSRZB6YHA6GPAH727ZC4EF';
UPDATE experiments SET slug = 'detecta0-sus-b10-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJXYVV9WT25JGFSAPJ8E57VQ';
UPDATE experiments SET slug = 'detecta0-sus-b10v2-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJY2ZPWY1MKS8GBCFNGARQCH';

-- DetectA(1) susceptibility experiments
UPDATE experiments SET slug = 'detecta1-sus-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJY3GYC63JRR19F6YWW4PEGE';
UPDATE experiments SET slug = 'detecta1-sus-b10-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJY3QHBQ4JF8T6MDEFJZ0VFR';
UPDATE experiments SET slug = 'detecta1-sus-synth-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KJY53C8CQWR2FM85SNRPP7HP';
UPDATE experiments SET slug = 'detecta1-sus-synth2-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0GG5BRR1W6W0Z459QS1XDV';
UPDATE experiments SET slug = 'detecta1-sus-synth3-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0GHYH3VX6DM6X8T8X0H411';

-- Short-titled experiments
UPDATE experiments SET slug = 'detecta0-sus-short-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0K5R66V0XX6QT83V5TKY0D';
UPDATE experiments SET slug = 'detecta0-sus-5step-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0KB4Y348GNZVRTGEZ312DS';
UPDATE experiments SET slug = 'detecta1-sus-5step-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0MP2DNGF2BBA0REKZAMHX7';

-- Sampling experiments
UPDATE experiments SET slug = 'detecta0-sampling-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0N0AP5PDH35FV45Z34K080';
UPDATE experiments SET slug = 'detecta0-sampling2-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0NDGFZD32ZQB5TSSM673V0';

-- DetectAor0 experiments
UPDATE experiments SET slug = 'detectaor0-noskip-local-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0VRS90CQ0ERWDA0APBWXRY';
UPDATE experiments SET slug = 'detectaor0-skip-local-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0VYMMDNE9TQ084MDT1RERD';
UPDATE experiments SET slug = 'detectaor0-skip-all-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0WJM9RA8WXAEAABHQ768NZ';
UPDATE experiments SET slug = 'detectaor0-skip-all-real-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0WT87EVD4M37CX8D5AN30F';
UPDATE experiments SET slug = 'detectaor0-noskip-all-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK0WVN5AC4841WGD2Z691XQ9';

-- CKA experiment
UPDATE experiments SET slug = 'cka-detecta0-vs-detecta1-' || lower(substr(experiment_id, 23, 4)) WHERE experiment_id = '01KK1G3ZMPHY3C1EWR974AWX6R';
