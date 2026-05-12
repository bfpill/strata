import { Hono } from "hono";
import { ulid } from "ulid";
import { authMiddleware, type AppEnv } from "../middleware";
import type { Env } from "../types";

// --- Slug generation ---

function slugify(text: string, maxLen = 30): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return slug || "exp";
}

function randomUid4(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

async function generateSlug(
  db: D1Database,
  stem: string,
): Promise<string> {
  // Try up to 5 times to generate a unique slug
  for (let i = 0; i < 5; i++) {
    const slug = `${stem}-${randomUid4()}`;
    const existing = await db
      .prepare("SELECT 1 FROM experiments WHERE slug = ?")
      .bind(slug)
      .first();
    if (!existing) return slug;
  }
  // Extremely unlikely fallback: use full ULID
  return `${stem}-${ulid().toLowerCase().slice(-8)}`;
}

// --- R2 path helpers ---

function runPrefix(slug: string, runIndex: number): string {
  return `experiments/${slug}/runs/${runIndex}/`;
}

function zarrPrefix(slug: string, runIndex: number): string {
  return `${runPrefix(slug, runIndex)}zarr/`;
}

// --- Canonical JSON ----------------------------------------------------
//
// The artifacts table has UNIQUE(run_id, label, params_json), so we need
// a stable string form for params: two clients sending {"a":1,"b":2} and
// {"b":2,"a":1} must hit the same row. Sort keys at every level.

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function canonicalParams(params: unknown): string {
  if (params == null) return "{}";
  if (typeof params !== "object") return "{}";
  return canonicalJson(params);
}

// --- Resolve slug or ULID to experiment_id ---

async function resolveExperiment(
  db: D1Database,
  slugOrId: string,
): Promise<Record<string, unknown> | null> {
  // ULIDs are 26 uppercase chars; slugs contain lowercase/hyphens
  const isUlid = /^[0-9A-Z]{26}$/.test(slugOrId);
  if (isUlid) {
    return db
      .prepare("SELECT * FROM experiments WHERE experiment_id = ?")
      .bind(slugOrId)
      .first();
  }
  return db
    .prepare("SELECT * FROM experiments WHERE slug = ?")
    .bind(slugOrId)
    .first();
}

async function resolveExperimentId(
  db: D1Database,
  slugOrId: string,
): Promise<{ experiment_id: string; slug: string } | null> {
  const isUlid = /^[0-9A-Z]{26}$/.test(slugOrId);
  const col = isUlid ? "experiment_id" : "slug";
  const row = await db
    .prepare(
      `SELECT experiment_id, slug FROM experiments WHERE ${col} = ?`,
    )
    .bind(slugOrId)
    .first<{ experiment_id: string; slug: string }>();
  return row || null;
}

// --- Lineage resolution ---

async function resolveLineage(
  env: Env,
  experimentId: string,
  sources: Record<string, any>,
): Promise<void> {
  for (const [, source] of Object.entries(sources)) {
    let srcSlug: string | null = null;

    if (typeof source === "object" && source !== null && source.slug) {
      // Structured ref: {"slug": "exp-slug", "run": 0}
      srcSlug = source.slug;
    }
    // Raw string URIs don't create lineage edges (no experiment to point to)

    if (!srcSlug) continue;

    const srcExp = await env.DB.prepare(
      "SELECT experiment_id FROM experiments WHERE slug = ?",
    )
      .bind(srcSlug)
      .first<{ experiment_id: string }>();

    if (srcExp) {
      const edgeId = ulid();
      await env.DB.prepare(
        `INSERT OR IGNORE INTO lineage_edges
         (edge_id, src_experiment_id, dst_experiment_id, relation)
         VALUES (?, ?, ?, 'derived_from')`,
      )
        .bind(edgeId, srcExp.experiment_id, experimentId)
        .run();
    }
  }
}

export const experimentsRouter = new Hono<AppEnv>();

// --- Public read endpoints ---

// GET /experiments/trash — tombstoned experiments and runs
experimentsRouter.get("/trash", async (c) => {
  const exps = await c.env.DB.prepare(
    `SELECT experiment_id, slug, "group", kind, title, tags, intent, created_at, created_by, status
     FROM experiments WHERE status = 'tombstoned'
     ORDER BY created_at DESC`,
  ).all();

  const runs = await c.env.DB.prepare(
    `SELECT r.run_id, r.experiment_id, r.run_index, r.label, r.status,
            e.slug AS experiment_slug, e.title AS experiment_title
     FROM runs r JOIN experiments e ON r.experiment_id = e.experiment_id
     WHERE r.status = 'tombstoned' AND e.status != 'tombstoned'
     ORDER BY r.run_id DESC`,
  ).all();

  return c.json({ experiments: exps.results, runs: runs.results });
});

// GET /experiments — feed
//
// Query params:
//   limit, offset
//   sort=activity|created (default: activity — most recently touched first)
//   author=NAME — filter to experiments created by this actor
//
// "Last activity" is max(e.created_at, max(a.updated_at) for artifacts on
// the experiment's runs). Used to surface experiments currently being
// edited even when they're old.
experimentsRouter.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 250);
  const offset = Number(c.req.query("offset") || 0);
  const sort = c.req.query("sort") === "created" ? "created" : "activity";
  const author = c.req.query("author");

  const conditions: string[] = [
    "e.status != 'tombstoned'",
    "e.visibility = 'public'",
  ];
  const binds: unknown[] = [];
  if (author) {
    conditions.push("e.created_by = ?");
    binds.push(author);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy =
    sort === "created"
      ? "e.created_at DESC"
      : `COALESCE(
           (SELECT MAX(a.updated_at) FROM artifacts a WHERE a.experiment_id = e.experiment_id),
           e.created_at
         ) DESC`;

  binds.push(limit, offset);
  const rows = await c.env.DB.prepare(
    `SELECT e.experiment_id, e.slug, e."group", e.kind, e.title, e.summary, e.tags,
            e.intent, e.created_at, e.created_by, e.status,
            COALESCE(
              (SELECT MAX(a.updated_at) FROM artifacts a WHERE a.experiment_id = e.experiment_id),
              e.created_at
            ) AS last_activity_at
     FROM experiments e
     ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds)
    .all();

  return c.json({
    experiments: rows.results,
    meta: { limit, offset, sort, author: author ?? null },
  });
});

// GET /experiments/:id — experiment detail (accepts slug or ULID)
experimentsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const exp = await resolveExperiment(c.env.DB, id);
  if (!exp) return c.json({ error: "Experiment not found" }, 404);
  return c.json(exp);
});

// GET /experiments/:id/runs
experimentsRouter.get("/:id/runs", async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT * FROM runs
     WHERE experiment_id = ? AND status != 'tombstoned'
     ORDER BY run_index`,
  )
    .bind(resolved.experiment_id)
    .all();

  return c.json({ runs: rows.results });
});

// GET /experiments/:id/artifacts
experimentsRouter.get("/:id/artifacts", async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const rows = await c.env.DB.prepare(
    "SELECT * FROM artifacts WHERE experiment_id = ? ORDER BY created_at",
  )
    .bind(resolved.experiment_id)
    .all();

  return c.json({ artifacts: rows.results });
});

// GET /experiments/:id/lineage
experimentsRouter.get("/:id/lineage", async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT * FROM lineage_edges
     WHERE src_experiment_id = ? OR dst_experiment_id = ?`,
  )
    .bind(resolved.experiment_id, resolved.experiment_id)
    .all();

  return c.json({ edges: rows.results });
});

// GET /experiments/:id/comments
experimentsRouter.get("/:id/comments", async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const rows = await c.env.DB.prepare(
    `SELECT * FROM comments
     WHERE experiment_id = ? AND deleted_at IS NULL
     ORDER BY created_at`,
  )
    .bind(resolved.experiment_id)
    .all();

  return c.json({ comments: rows.results });
});

// GET /experiments/:id/manifest — assembled from D1 (no R2 read)
experimentsRouter.get("/:id/manifest", async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const runIndex = Number(c.req.query("run") || 0);

  const run = await c.env.DB.prepare(
    `SELECT run_id, hparams_json, dataset_kinds, sources_json,
            artifact_layouts_json, invocations_json
     FROM runs WHERE experiment_id = ? AND run_index = ?`,
  )
    .bind(resolved.experiment_id, runIndex)
    .first<{
      run_id: string;
      hparams_json: string | null;
      dataset_kinds: string | null;
      sources_json: string | null;
      artifact_layouts_json: string | null;
      invocations_json: string | null;
    }>();

  if (!run) return c.json({ error: "Run not found" }, 404);

  // Get experiment-level fields
  const exp = await c.env.DB.prepare(
    "SELECT intent, synth_prob_json FROM experiments WHERE experiment_id = ?",
  )
    .bind(resolved.experiment_id)
    .first<{ intent: string | null; synth_prob_json: string | null }>();

  // Get artifacts for this run, hydrate params from JSON column
  const artifactRows = await c.env.DB.prepare(
    "SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at",
  )
    .bind(run.run_id)
    .all();

  const artifacts = artifactRows.results.map((a: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...a };
    if (typeof a.params_json === "string") {
      out.params = JSON.parse(a.params_json as string);
    }
    delete out.params_json;
    // Derive html_uri for plotly_json artifacts (same path, .html extension)
    if (a.artifact_type === "plotly_json" && typeof a.uri === "string") {
      out.html_uri = (a.uri as string).replace(/\.json$/, ".html");
    }
    return out;
  });

  const manifest: Record<string, any> = {
    hparams: run.hparams_json ? JSON.parse(run.hparams_json) : {},
    intent: exp?.intent || "",
    sources: run.sources_json ? JSON.parse(run.sources_json) : {},
    outputs: {
      artifacts,
      artifact_layouts: run.artifact_layouts_json
        ? JSON.parse(run.artifact_layouts_json)
        : {},
    },
  };

  if (exp?.synth_prob_json) {
    manifest.synth_prob = JSON.parse(exp.synth_prob_json);
  }

  if (run.invocations_json) {
    manifest.invocations = JSON.parse(run.invocations_json);
  }

  return c.json(manifest);
});

// --- Authenticated write endpoints ---

// POST /experiments/create
experimentsRouter.post("/create", authMiddleware, async (c) => {
  const actor = c.get("actor");
  const body = await c.req.json();

  if (!body.title) {
    return c.json({ error: "title is required" }, 400);
  }

  const experimentId = ulid();
  const now = new Date().toISOString();

  // Generate slug from name or title
  const stem = slugify(body.name || body.title);
  const slug = await generateSlug(c.env.DB, stem);

  await c.env.DB.prepare(
    `INSERT INTO experiments
     (experiment_id, slug, "group", kind, title, summary, tags,
      intent, synth_prob_json,
      created_at, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
  ).bind(
    experimentId,
    slug,
    body.group || null,
    body.kind || "single",
    body.title,
    body.summary || null,
    JSON.stringify(body.tags || []),
    body.intent || null,
    body.synth_prob ? JSON.stringify(body.synth_prob) : null,
    now,
    actor,
  ).run();

  return c.json(
    {
      experiment_id: experimentId,
      slug,
    },
    201,
  );
});

// POST /experiments/:id/runs/create — add a run to an existing experiment
experimentsRouter.post("/:id/runs/create", authMiddleware, async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const runId = ulid();
  const now = new Date().toISOString();

  // Assign next run_index atomically
  const maxRow = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(run_index), -1) + 1 AS next_index FROM runs WHERE experiment_id = ?",
  )
    .bind(resolved.experiment_id)
    .first<{ next_index: number }>();

  const runIndex = maxRow?.next_index ?? 0;

  await c.env.DB.prepare(
    `INSERT INTO runs (run_id, experiment_id, run_index, status, label, started_at)
     VALUES (?, ?, ?, 'initialised', ?, ?)`,
  ).bind(runId, resolved.experiment_id, runIndex, body.label || null, now).run();

  return c.json(
    {
      run_id: runId,
      run_index: runIndex,
    },
    201,
  );
});

// POST /experiments/:id/runs/:index/finalize
//
// Finalize is now non-destructive. It marks the run as finalized and
// appends an invocation record. Run-level metadata (hparams, sources,
// dataset_kinds, artifact_layouts, notes) and artifacts each have their
// own endpoints (PATCH /runs/:idx, PUT /runs/:idx/artifacts) that commit
// independently. For backward compatibility, this endpoint still accepts
// those fields in the body and forwards them to the relevant code paths
// — without ever wiping existing artifacts.
experimentsRouter.post(
  "/:id/runs/:index/finalize",
  authMiddleware,
  async (c) => {
    const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
    if (!resolved) return c.json({ error: "Experiment not found" }, 404);

    const runIndex = Number(c.req.param("index"));
    const now = new Date().toISOString();

    const run = await c.env.DB.prepare(
      "SELECT run_id, status FROM runs WHERE experiment_id = ? AND run_index = ?",
    )
      .bind(resolved.experiment_id, runIndex)
      .first<{ run_id: string; status: string }>();

    if (!run) return c.json({ error: "Run not found" }, 404);
    if (run.status === "tombstoned") {
      return c.json({ error: "Run is deleted" }, 409);
    }

    const slug = resolved.slug;
    const body = await c.req.json().catch(() => ({}));
    const invocation: Record<string, any> | null = body.invocation || null;

    // 1. Append invocation to existing list
    let invocations: Record<string, any>[] = [];
    const existing = await c.env.DB.prepare(
      "SELECT invocations_json FROM runs WHERE run_id = ?",
    )
      .bind(run.run_id)
      .first<{ invocations_json: string | null }>();
    if (existing?.invocations_json) {
      try {
        invocations = JSON.parse(existing.invocations_json);
      } catch {}
    }
    if (invocation) invocations.push(invocation);

    // 2. Mark finalized + append invocation. Other run-level fields
    //    only get touched if explicitly provided in the body.
    const sets: string[] = [
      "finished_at = ?",
      "success = 1",
      "status = 'finalized'",
      "invocations_json = ?",
    ];
    const binds: unknown[] = [now, JSON.stringify(invocations)];
    if (body.hparams !== undefined) {
      sets.push("hparams_json = ?");
      binds.push(JSON.stringify(body.hparams));
    }
    if (body.sources !== undefined) {
      sets.push("sources_json = ?");
      binds.push(JSON.stringify(body.sources));
    }
    if (body.dataset_kinds !== undefined) {
      sets.push("dataset_kinds = ?");
      binds.push(JSON.stringify(body.dataset_kinds));
    }
    if (body.artifact_layouts !== undefined) {
      sets.push("artifact_layouts_json = ?");
      binds.push(JSON.stringify(body.artifact_layouts));
    }
    binds.push(run.run_id);

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE runs SET ${sets.join(", ")} WHERE run_id = ?`,
      ).bind(...binds),
      c.env.DB.prepare(
        "UPDATE experiments SET status = 'active' WHERE experiment_id = ?",
      ).bind(resolved.experiment_id),
    ]);

    // 3. If the body still ships an `artifacts` array (legacy clients),
    //    upsert each — but never delete siblings. New clients use the
    //    dedicated PUT /runs/:idx/artifacts endpoint per upload.
    const artifacts: Record<string, any>[] = Array.isArray(body.artifacts)
      ? body.artifacts
      : [];
    for (const art of artifacts) {
      await upsertArtifact(c.env.DB, {
        experimentId: resolved.experiment_id,
        runId: run.run_id,
        artifactType: art.artifact_type || "unknown",
        label: art.label ?? "",
        uri: art.uri || "",
        contentHash: art.content_hash ?? null,
        sizeBytes: art.size_bytes ?? null,
        params: art.params,
        now,
      });
    }

    // 4. Auto-discover lineage from structured sources
    if (body.sources !== undefined) {
      await resolveLineage(c.env, resolved.experiment_id, body.sources);
    }

    return c.json({
      status: "finalized",
      experiment_id: resolved.experiment_id,
      slug,
      run_index: runIndex,
    });
  },
);

// --- Artifact upsert ---------------------------------------------------
//
// Idempotent registration: PUT one artifact, keyed by
// (run_id, label, canonical(params_json)). Re-uploads with the same
// identity bump uri/content_hash/size_bytes/updated_at; other artifacts
// on the run are left untouched. This is the surgical replacement for
// the old "finalize wipes and reinserts everything" pattern.

interface UpsertArtifactInput {
  experimentId: string;
  runId: string;
  artifactType: string;
  label: string;
  uri: string;
  contentHash: string | null;
  sizeBytes: number | null;
  params: unknown;
  now: string;
}

async function upsertArtifact(
  db: D1Database,
  input: UpsertArtifactInput,
): Promise<{ artifact_id: string; created: boolean }> {
  const paramsJson = canonicalParams(input.params);
  const label = input.label ?? "";

  // Lookup existing by identity. UNIQUE(run_id, label, params_json)
  // guarantees at most one row.
  const existing = await db
    .prepare(
      "SELECT artifact_id FROM artifacts WHERE run_id = ? AND label = ? AND params_json = ?",
    )
    .bind(input.runId, label, paramsJson)
    .first<{ artifact_id: string }>();

  if (existing) {
    await db
      .prepare(
        `UPDATE artifacts SET
           artifact_type = ?, uri = ?, content_hash = ?, size_bytes = ?,
           updated_at = ?
         WHERE artifact_id = ?`,
      )
      .bind(
        input.artifactType,
        input.uri,
        input.contentHash,
        input.sizeBytes,
        input.now,
        existing.artifact_id,
      )
      .run();
    return { artifact_id: existing.artifact_id, created: false };
  }

  const artifactId = ulid();
  await db
    .prepare(
      `INSERT INTO artifacts
       (artifact_id, experiment_id, run_id, artifact_type, label, uri,
        content_hash, size_bytes, params_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      artifactId,
      input.experimentId,
      input.runId,
      input.artifactType,
      label,
      input.uri,
      input.contentHash,
      input.sizeBytes,
      paramsJson,
      input.now,
      input.now,
    )
    .run();
  return { artifact_id: artifactId, created: true };
}

// PUT /experiments/:id/runs/:index/layouts/:label — merge one layout
//
// Sets artifact_layouts[label] = body.layout without touching any other
// label's layout. Lets per-label layout calls accumulate without the
// caller having to read+merge+write.
experimentsRouter.put(
  "/:id/runs/:index/layouts/:label",
  authMiddleware,
  async (c) => {
    const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
    if (!resolved) return c.json({ error: "Experiment not found" }, 404);

    const runIndex = Number(c.req.param("index"));
    const label = c.req.param("label");

    const run = await c.env.DB.prepare(
      "SELECT run_id, artifact_layouts_json FROM runs WHERE experiment_id = ? AND run_index = ?",
    )
      .bind(resolved.experiment_id, runIndex)
      .first<{ run_id: string; artifact_layouts_json: string | null }>();
    if (!run) return c.json({ error: "Run not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    if (body.layout === undefined) {
      return c.json({ error: "layout is required" }, 400);
    }

    let layouts: Record<string, unknown> = {};
    if (run.artifact_layouts_json) {
      try {
        layouts = JSON.parse(run.artifact_layouts_json);
      } catch {}
    }
    layouts[label] = body.layout;

    await c.env.DB.prepare(
      "UPDATE runs SET artifact_layouts_json = ? WHERE run_id = ?",
    )
      .bind(JSON.stringify(layouts), run.run_id)
      .run();

    return c.json({ status: "updated", label });
  },
);

// PUT /experiments/:id/runs/:index/artifacts — idempotent single upsert.
experimentsRouter.put(
  "/:id/runs/:index/artifacts",
  authMiddleware,
  async (c) => {
    const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
    if (!resolved) return c.json({ error: "Experiment not found" }, 404);

    const runIndex = Number(c.req.param("index"));
    const run = await c.env.DB.prepare(
      "SELECT run_id, status FROM runs WHERE experiment_id = ? AND run_index = ?",
    )
      .bind(resolved.experiment_id, runIndex)
      .first<{ run_id: string; status: string }>();
    if (!run) return c.json({ error: "Run not found" }, 404);
    if (run.status === "tombstoned") {
      return c.json({ error: "Run is deleted" }, 409);
    }

    const body = await c.req.json().catch(() => ({}));
    if (!body.uri) {
      return c.json({ error: "uri is required" }, 400);
    }

    const result = await upsertArtifact(c.env.DB, {
      experimentId: resolved.experiment_id,
      runId: run.run_id,
      artifactType: body.artifact_type || "unknown",
      label: body.label ?? "",
      uri: body.uri,
      contentHash: body.content_hash ?? null,
      sizeBytes: body.size_bytes ?? null,
      params: body.params,
      now: new Date().toISOString(),
    });

    return c.json(
      {
        artifact_id: result.artifact_id,
        created: result.created,
      },
      result.created ? 201 : 200,
    );
  },
);

// PATCH /experiments/:id — update experiment metadata
experimentsRouter.patch("/:id", authMiddleware, async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const body = await c.req.json();
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (body.title !== undefined) {
    sets.push("title = ?");
    binds.push(body.title);
  }
  if (body.summary !== undefined) {
    sets.push("summary = ?");
    binds.push(body.summary);
  }
  if (body.group !== undefined) {
    sets.push('"group" = ?');
    binds.push(body.group);
  }
  if (body.tags !== undefined) {
    sets.push("tags = ?");
    binds.push(JSON.stringify(body.tags));
  }
  if (body.intent !== undefined) {
    sets.push("intent = ?");
    binds.push(body.intent);
  }
  if (body.synth_prob !== undefined) {
    sets.push("synth_prob_json = ?");
    binds.push(JSON.stringify(body.synth_prob));
  }
  if (body.status !== undefined) {
    sets.push("status = ?");
    binds.push(body.status);
  }
  if (body.doc_slugs !== undefined) {
    sets.push("doc_slugs = ?");
    binds.push(JSON.stringify(body.doc_slugs));
  }

  if (sets.length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  binds.push(resolved.experiment_id);
  await c.env.DB.prepare(
    `UPDATE experiments SET ${sets.join(", ")} WHERE experiment_id = ?`,
  )
    .bind(...binds)
    .run();

  return c.json({ status: "updated" });
});

// GET /experiments/:id/notes
experimentsRouter.get("/:id/notes", async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const row = await c.env.DB.prepare(
    `SELECT notes_markdown, notes_updated_at, notes_updated_by FROM experiments WHERE experiment_id = ?`,
  )
    .bind(resolved.experiment_id)
    .first();

  return c.json({
    notes_markdown: row?.notes_markdown ?? null,
    notes_updated_at: row?.notes_updated_at ?? null,
    notes_updated_by: row?.notes_updated_by ?? null,
  });
});

// PATCH /experiments/:id/notes
experimentsRouter.patch("/:id/notes", authMiddleware, async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const actor = c.get("actor");
  const body = await c.req.json();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE experiments SET notes_markdown = ?, notes_updated_at = ?, notes_updated_by = ?
     WHERE experiment_id = ?`,
  )
    .bind(body.notes_markdown, now, actor, resolved.experiment_id)
    .run();

  return c.json({ status: "updated" });
});

// POST /experiments/:id/comments
experimentsRouter.post("/:id/comments", authMiddleware, async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const actor = c.get("actor");
  const body = await c.req.json();
  const commentId = ulid();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO comments (comment_id, experiment_id, author, body_markdown, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(commentId, resolved.experiment_id, actor, body.body_markdown, now)
    .run();

  return c.json({ comment_id: commentId }, 201);
});

// DELETE /experiments/:id — soft-delete experiment
experimentsRouter.delete("/:id", authMiddleware, async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  await c.env.DB.prepare(
    "UPDATE experiments SET status = 'tombstoned' WHERE experiment_id = ?",
  )
    .bind(resolved.experiment_id)
    .run();

  return c.json({ status: "deleted" });
});

// DELETE /experiments/:id/runs/:index — soft-delete a run
experimentsRouter.delete("/:id/runs/:index", authMiddleware, async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const runIndex = Number(c.req.param("index"));

  await c.env.DB.prepare(
    `UPDATE runs SET status = 'tombstoned'
     WHERE experiment_id = ? AND run_index = ?`,
  )
    .bind(resolved.experiment_id, runIndex)
    .run();

  return c.json({ status: "deleted" });
});

// PATCH /experiments/:id/runs/:index — update run metadata
//
// Accepts any subset of: label, status, hparams, sources, dataset_kinds,
// artifact_layouts. Each lands as an independent column update so callers
// can correct individual fields after finalize without having to
// re-finalize the whole run.
experimentsRouter.patch("/:id/runs/:index", authMiddleware, async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const runIndex = Number(c.req.param("index"));
  const body = await c.req.json();

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.label !== undefined) {
    sets.push("label = ?");
    binds.push(body.label);
  }
  if (body.status !== undefined) {
    sets.push("status = ?");
    binds.push(body.status);
  }
  if (body.hparams !== undefined) {
    sets.push("hparams_json = ?");
    binds.push(JSON.stringify(body.hparams));
  }
  if (body.sources !== undefined) {
    sets.push("sources_json = ?");
    binds.push(JSON.stringify(body.sources));
  }
  if (body.dataset_kinds !== undefined) {
    sets.push("dataset_kinds = ?");
    binds.push(JSON.stringify(body.dataset_kinds));
  }
  if (body.artifact_layouts !== undefined) {
    sets.push("artifact_layouts_json = ?");
    binds.push(JSON.stringify(body.artifact_layouts));
  }
  if (sets.length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }
  binds.push(resolved.experiment_id, runIndex);
  await c.env.DB.prepare(
    `UPDATE runs SET ${sets.join(", ")} WHERE experiment_id = ? AND run_index = ?`,
  )
    .bind(...binds)
    .run();

  // Re-resolve lineage edges when sources change.
  if (body.sources !== undefined) {
    await resolveLineage(c.env, resolved.experiment_id, body.sources);
  }

  return c.json({ status: "updated" });
});

// DELETE /experiments/:id/runs/:index/artifacts — delete artifacts by label
experimentsRouter.delete(
  "/:id/runs/:index/artifacts",
  authMiddleware,
  async (c) => {
    const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
    if (!resolved) return c.json({ error: "Experiment not found" }, 404);

    const runIndex = Number(c.req.param("index"));
    const label = c.req.query("label");

    // Get run_id
    const run = await c.env.DB.prepare(
      "SELECT run_id FROM runs WHERE experiment_id = ? AND run_index = ?",
    )
      .bind(resolved.experiment_id, runIndex)
      .first<{ run_id: string }>();

    if (!run) return c.json({ error: "Run not found" }, 404);

    if (label) {
      // Delete specific label (all params variants)
      await c.env.DB.prepare(
        "DELETE FROM artifacts WHERE run_id = ? AND label = ?",
      )
        .bind(run.run_id, label)
        .run();
      return c.json({ status: "deleted", label });
    }
    // Delete all artifacts for this run
    await c.env.DB.prepare(
      "DELETE FROM artifacts WHERE run_id = ?",
    )
      .bind(run.run_id)
      .run();
    return c.json({ status: "deleted", all: true });
  },
);

// POST /experiments/:id/members — add comparison member
experimentsRouter.post("/:id/members", authMiddleware, async (c) => {
  const resolved = await resolveExperimentId(c.env.DB, c.req.param("id"));
  if (!resolved) return c.json({ error: "Experiment not found" }, 404);

  const body = await c.req.json();

  await c.env.DB.prepare(
    `INSERT INTO comparison_members (comparison_experiment_id, member_experiment_id, member_run_id, position)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(
      resolved.experiment_id,
      body.member_experiment_id,
      body.member_run_id || "",
      body.position || 0,
    )
    .run();

  return c.json({ status: "member_added" }, 201);
});
