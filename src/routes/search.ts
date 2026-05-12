import { Hono } from "hono";
import type { AppEnv } from "../middleware";

export const searchRouter = new Hono<AppEnv>();

// GET /search?q=...&kind=...&group=...&tag=...&dataset=...&hparam.beta=1.0&hparam.num_chains=8
// Additional params:
//   author=NAME — exact match on created_by
//   sort=activity|created (default: activity)
searchRouter.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 50), 250);
  const offset = Number(c.req.query("offset") || 0);

  const q = c.req.query("q");
  const kind = c.req.query("kind");
  const group = c.req.query("group");
  const tag = c.req.query("tag");
  const dataset = c.req.query("dataset");
  const author = c.req.query("author");
  const sort = c.req.query("sort") === "created" ? "created" : "activity";

  // Collect hparam.* query params
  const hparamFilters: [string, string][] = [];
  const url = new URL(c.req.url);
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith("hparam.")) {
      hparamFilters.push([key.slice(7), value]);
    }
  }

  const needsRunJoin = hparamFilters.length > 0 || !!dataset;

  const conditions: string[] = [
    "e.status != 'tombstoned'",
    "e.visibility = 'public'",
  ];
  const binds: unknown[] = [];

  // Full-text search (LIKE on title, summary, notes, author)
  if (q) {
    conditions.push(
      "(e.title LIKE ? OR e.summary LIKE ? OR e.notes_markdown LIKE ? OR e.created_by LIKE ?)",
    );
    const pattern = `%${q}%`;
    binds.push(pattern, pattern, pattern, pattern);
  }

  // Experiment-level filters
  if (kind) {
    conditions.push("e.kind = ?");
    binds.push(kind);
  }

  if (group) {
    conditions.push('e."group" = ?');
    binds.push(group);
  }

  if (tag) {
    conditions.push("e.tags LIKE ?");
    binds.push(`%"${tag}"%`);
  }

  if (author) {
    conditions.push("e.created_by = ?");
    binds.push(author);
  }

  // Run-level filters (hparams via json_extract, dataset_kinds)
  if (dataset) {
    conditions.push("r.dataset_kinds LIKE ?");
    binds.push(`%"${dataset}"%`);
  }

  for (const [key, value] of hparamFilters) {
    const jsonPath = `$.${key}`;
    const numVal = Number(value);
    if (!isNaN(numVal) && value.trim() !== "") {
      conditions.push(`json_extract(r.hparams_json, ?) = ?`);
      binds.push(jsonPath, numVal);
    } else {
      conditions.push(`json_extract(r.hparams_json, ?) = ?`);
      binds.push(jsonPath, value);
    }
  }

  const join = needsRunJoin
    ? "LEFT JOIN runs r ON e.experiment_id = r.experiment_id AND r.status != 'tombstoned'"
    : "";

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const orderBy =
    sort === "created"
      ? "e.created_at DESC"
      : `COALESCE(
           (SELECT MAX(a.updated_at) FROM artifacts a WHERE a.experiment_id = e.experiment_id),
           e.created_at
         ) DESC`;

  const sql = `
    SELECT DISTINCT e.experiment_id, e.slug, e."group", e.kind, e.title,
           e.summary, e.tags, e.intent, e.created_at, e.created_by, e.status,
           COALESCE(
             (SELECT MAX(a.updated_at) FROM artifacts a WHERE a.experiment_id = e.experiment_id),
             e.created_at
           ) AS last_activity_at
    FROM experiments e
    ${join}
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  binds.push(limit, offset);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all();

  return c.json({ experiments: rows.results, meta: { limit, offset } });
});
