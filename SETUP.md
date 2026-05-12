# Strata Setup

## Using Strata (publishing experiments from Python)

### 1. Set up credentials

Copy the env template and fill in your keys:

```bash
cp .env.example .env
```

You need two sets of credentials in `.env`:

**STRATA_API_KEY** — shared API key for the tracker API. Ask whoever deployed
Strata for this.

**R2 credentials** — for writing Zarr stores directly to Cloudflare R2:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Storage & Databases → R2 Object Storage → Overview**
3. Click **Manage R2 API Tokens** (top right, `{}` icon)
4. Under **User API Tokens**, click **Create API Token**
5. Set permissions to **Object Read & Write**, scope to the `aixi` bucket
6. Copy the **Access Key ID** and **Secret Access Key** into `.env`

Your `.env` should look like:
```
STRATA_API_KEY=<the shared key>
STRATA_API_URL=https://strata.timaeus-research-inc.workers.dev
R2_ACCESS_KEY_ID=<your access key>
R2_SECRET_ACCESS_KEY=<your secret key>
R2_ACCOUNT_ID=d00038c6596061598646a3726dd77a60
R2_BUCKET=aixi
```

### 2. Use the web frontend

Go to https://strata-1ay.pages.dev. To edit notes or post comments, click
"Sign in" in the header and enter:
- **API key**: the `STRATA_API_KEY` value from your `.env` file
- **Your name**: how you want to be attributed (e.g. `billy`)

### 3. Publish an experiment

```python
from aixi.tracker import TrackerClient

client = TrackerClient(actor="billy")

# Create experiment
exp = client.create_experiment(
    title="DetectA susceptibility vary beta",
    name="sus",              # optional slug stem
    group="sampling",        # optional grouping
    tags=["detectA", "sus"],
)

# Build your data
import xarray as xr
dt = xr.DataTree.from_dict({"/sus": sus_ds, "/sampling/full": full_ds})

# Upload data with manifest attrs (one call)
run = exp.run  # RunHandle for run index 0
run.upload_data(
    dt,
    hparams={"beta": 1.0, "num_chains": 8, "steps": 400, "seed": 42},
    synth_config=synth_config,  # optional TMSynthesisConfig
    intent="Beta sensitivity check",
    script_path=__file__,
)

# Upload plots
run.upload_artifact("plots/heatmap.html", label="heatmap")

# Finalize (server reads zarr attrs, builds manifest.json, indexes)
run.finalize()
print(f"Published: https://strata-1ay.pages.dev/e/{exp.slug}")
```

### 4. Multiple runs

```python
exp = client.create_experiment(title="Vary beta", group="sampling")
for i, beta in enumerate([0.1, 1.0, 10.0]):
    run = exp.run if i == 0 else exp.create_run()
    dt = compute_sus(beta=beta)
    run.upload_data(dt, hparams={"beta": beta, "num_chains": 8})
    run.finalize()
```

### 5. Read experiments

```python
client = TrackerClient()  # no auth needed for reads
exps = client.list_experiments()
result = client.search(**{"hparam.beta": "1.0", "group": "sampling"})
manifest = client.get_manifest("sus-k9x1")
```

---

## Local Development

### Prerequisites

```bash
cd aixi/strata
npm install
cd web && npm install && cd ..
```

API secrets for local dev:
```bash
cp .dev.vars.example .dev.vars
# Fill in STRATA_API_KEY (same as prod for --remote, or any string for --local)
```

### Start dev servers

**Terminal 1 — API** (hits prod D1/R2):
```bash
cd aixi/strata
npm run dev              # → http://localhost:8787 (remote D1/R2)
```

Or for fully local (local SQLite D1, local R2):
```bash
npm run dev:local        # → http://localhost:8787 (local D1/R2)
npm run db:migrate:local # apply schema to local D1 first
```

**Terminal 2 — Frontend** (auto-connects to localhost:8787):
```bash
cd aixi/strata/web
npm run dev              # → http://localhost:5173
```

The frontend `npm run dev` sets `VITE_API_URL=http://localhost:8787` so it
talks to whichever API server you started in terminal 1.

### Deploy

```bash
# API
cd aixi/strata
npm run deploy

# Frontend
cd aixi/strata/web
npm run build
npx wrangler pages deploy dist --project-name strata
```

### DB migrations

```bash
# Apply schema to local D1
npm run db:migrate:local

# Apply to prod D1
npm run db:migrate:remote

# Run a specific migration file on prod
npx wrangler d1 execute strata-db --remote --file=src/db/migration-v4.sql
```

### Project structure

```
aixi/strata/                       ← Cloudflare Workers API (TypeScript)
├── src/
│   ├── index.ts                   ← Hono app entry
│   ├── types.ts                   ← Env bindings type
│   ├── middleware.ts               ← Auth (API key + X-Actor)
│   ├── routes/
│   │   ├── experiments.ts         ← Experiment/run CRUD + finalize + indexer
│   │   ├── search.ts             ← Search (hparam.X=Y via json_extract)
│   │   └── data.ts               ← R2 byte proxy for zarr/artifacts
│   └── db/
│       ├── schema.sql             ← D1 schema (v4)
│       └── migration-v4.sql       ← Migration from v3.1
├── wrangler.jsonc                 ← Cloudflare config
└── web/                           ← React frontend (Vite + Cloudflare Pages)
    └── src/
        ├── api.ts                 ← API client + types
        ├── pages/
        │   ├── Feed.tsx           ← Experiment list
        │   ├── ExperimentDetail.tsx ← Detail page
        │   └── GroupListing.tsx   ← Group page
        └── components/
            ├── PlotArtifact.tsx   ← HTML plot viewer
            └── SynthConfig.tsx    ← Synthesis problem display

aixi/src/aixi/tracker/             ← Python publisher library
├── __init__.py
├── client.py                      ← TrackerClient, ExperimentHandle, RunHandle
├── storage.py                     ← R2/obstore/zarr storage utils
└── marimo.py                      ← publish_experiment() convenience
```
