# Strata Implementation Progress

Reference: `aixi/docs/strata/design-spec.md` (v3.1)

## Current status

**Phase 1–4 complete. Notebook publish flow working end-to-end.**

### Done

- [x] D1 schema: 7 tables, 12 indexes (`src/db/schema.sql`)
- [x] Workers API: all spec §9 endpoints + GET /search
  - `src/routes/experiments.ts` — CRUD, notes, comments, lineage, members
  - `src/routes/search.ts` — structured filters (kind, tm_name, beta,
    synthesis_problem_id, tag, payload_profile, has_trajectories) + text search
  - `src/middleware.ts` — API key auth + X-Actor attribution
- [x] Cloudflare resources (Timaeus Research, Inc. account):
  - R2 bucket: `aixi`, D1: `strata-db` (`5e975b9e-9a2c-4af1-ba83-e9a6bfce1090`, OC/Sydney)
- [x] Deployed at `https://strata.timaeus-research-inc.workers.dev`
- [x] Python publisher library (`aixi/src/aixi/tracker/`)
  - `TrackerClient` — create, list, search, notes, comments, tombstone
  - `ExperimentHandle` — get_zarr_store, upload_artifact, finalize
  - `storage.py` — R2/obstore/zarr utils (r2_store, zarr_store, upload_file)
  - Auto-captures git provenance + package versions
  - Credentials via `.env` + `load_dotenv()`
- [x] R2 direct writes from Python via obstore + zarr.storage.ObjectStore
- [x] Full end-to-end verified: create → write Zarr v3 to R2 → upload manifest
  → consolidate metadata → finalize → read Zarr back from R2

- [x] Indexer in finalize: reads manifest + zarr.json from R2, populates
  search_index (tm_name, beta, chains, steps, dataset_kinds, etc.) and
  registers artifacts in D1. Experiment status transitions to 'indexed'.
- [x] Real detectA susceptibility experiment published and verified:
  sus[62,18] + sampling trajectories, all readable from R2.
  Search by tm_name works.

### Not yet done

- [ ] `manifest.schema.json` v3.1 (JSON Schema for validation)
- [ ] Generate `TMSynthesisConfig` JSON schema via Pydantic
- [ ] Upload synthesis problem configs (detectA, detectAor0) to R2
- [ ] Implement prefix-scoped R2 temp credentials in POST /create

- [x] React + Vite frontend deployed to Cloudflare Pages
  - Feed page: lists experiments with status badges, tags, time-ago
  - Experiment detail: hparams, roots, run info, artifacts, provenance,
    notes (Markdown), comments, full manifest (collapsible)
  - Live at `https://strata-web-epa.pages.dev`
  - SPA routing with `_redirects`
  - Notes editing, comment posting, auth (API key in localStorage)
  - Search bar with URL query param sync
  - Plotly HTML artifacts rendered inline as iframes
- [x] R2 byte proxy (`GET /data/r2/*`) for artifact serving + Zarr access
- [x] Marimo publish integration (`aixi/src/aixi/tracker/marimo.py`)
  - `publish_experiment()` function: uploads Zarr, synth_config, Plotly figures
  - Button in detectA notebook publishes sus + PCA/UMAP data + 6 plots
  - Zarr patch for nested groups (zarr-python #3639)
- [x] Full notebook-to-tracker publish verified with real detectA experiment
  - 7 artifacts (synth_config JSON + 6 Plotly HTML)
  - DataTree with /sus, /embed/pca, /embed/umap

### Next priorities

- [ ] **Export all figures from detectAor0.py and sampling/detectA.py**:
  - detectAor0: rename `_fig1/_fig2/_fig3` (symmetry sus, ~line 661-718),
    `_kfig1/_kfig2` (kernel comparison, ~line 737-775) to non-underscore names
  - detectAor0: use `plotly.subplots.make_subplots` to combine side-by-side figs
    into single figures for publishing (symmetry_sus, symmetry_kernel)
  - sampling/detectA: rename `_fig` in distance-from-init (~line 523),
    chain trajectory (~line 615), scatter (~line 748), theta drift (~line 823)
  - Add all to return statements and to publish_form figures dict
- [ ] Sweep support (Phase 5)
- [ ] `manifest.schema.json` validation
- [ ] Prefix-scoped R2 temp credentials in POST /create

## Architecture

```
aixi/strata/                  ← Cloudflare Workers API (TypeScript)
  src/
    index.ts                  ← Hono app entry point
    types.ts                  ← Env bindings
    middleware.ts              ← Auth + X-Actor
    routes/experiments.ts      ← All experiment endpoints
    db/schema.sql             ← D1 schema
  wrangler.jsonc              ← Cloudflare config
  package.json
  tsconfig.json

aixi/strata/web/              ← React + Vite frontend (Cloudflare Pages)
  src/
    pages/Feed.tsx            ← Experiment feed
    pages/ExperimentDetail.tsx ← Experiment detail page
    api.ts                    ← API client
    style.css
aixi/src/aixi/tracker/        ← Python publisher library
aixi/docs/strata/             ← Design spec + archive
```

## Production URLs (Timaeus Research, Inc.)

- **API**: https://strata.timaeus-research-inc.workers.dev
- **Frontend**: https://strata-1ay.pages.dev
- **API key**: stored in `.dev.vars` (local) and as Cloudflare secret (remote)
- **Cloudflare dashboard**: https://dash.cloudflare.com/d00038c6596061598646a3726dd77a60
- **D1 database**: `strata-db` (`5e975b9e-9a2c-4af1-ba83-e9a6bfce1090`, OC/Sydney)
- **R2 bucket**: `aixi`

### Legacy (personal account, read-only)

- **API**: https://strata.billy-8a8.workers.dev
- **Frontend**: https://strata-web-epa.pages.dev
- **Dashboard**: https://dash.cloudflare.com/8a8545d9e49726b0776241390b4a4f9f

## Key decisions made during implementation

1. **Hono** as the API framework (lightweight, Workers-native, good TypeScript)
2. **ULID** for experiment/run/artifact IDs (lexicographically sortable)
3. **AppEnv type** shared across middleware and routes for type-safe `c.get("actor")`
4. Comparison members use `member_run_id DEFAULT ''` (not NULL) to work with
   SQLite composite primary keys

## Cloudflare account migration (completed 2026-03-07)

Migrated from Billy's personal account (`8a8545d9e49726b0776241390b4a4f9f`) to
Timaeus Research, Inc. (`d00038c6596061598646a3726dd77a60`).

- D1 data exported from personal, imported into new Timaeus D1 (23 experiments)
- R2 data copied via rclone (658 objects, 512 MiB)
- Personal deployment kept alive as read-only legacy (shared links still work)
- Note: `CLOUDFLARE_ACCOUNT_ID` env var is ignored by wrangler for some operations;
  the `account_id` in `wrangler.jsonc` is authoritative

## What the next agent should do

1. **Artifact display improvements** (highest priority UX):
   - Auto-size iframes to content height (no fixed 500px)
   - Make each plot collapsible (details/summary or similar)
   - Add fullscreen button per plot
   - Add "Download HTML" button per plot (link to R2 proxy URL)
   - Support artifact layout groups: publisher specifies `group="pca"` on
     artifacts, frontend renders grouped artifacts as tabs or dropdown
   - Remove role badges ("overview"/"primary_view") from display

2. **Artifact grouping in publish API**: add `group` field to artifact metadata
   so publisher can say `group="pca"` for pca_2d/pca_3d and `group="umap"` for
   umap_2d/umap_3d. Frontend renders each group as a tabbed section.

3. **Deploy frontend changes**: `cd aixi/strata/web && npx vite build && CLOUDFLARE_ACCOUNT_ID=d00038c6596061598646a3726dd77a60 npx wrangler pages deploy dist --project-name strata`

4. **Sweep support** (Phase 5)
