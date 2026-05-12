export const API_URL = import.meta.env.VITE_API_URL || "https://strata.timaeus-research-inc.workers.dev";

export interface Experiment {
  experiment_id: string;
  slug: string;
  group: string | null;
  kind: string;
  title: string;
  tags: string; // JSON array
  created_at: string;
  created_by: string;
  status: string;
  intent: string | null;
  synth_prob_json: string | null;
  notes_markdown: string | null;
  notes_updated_at: string | null;
  notes_updated_by: string | null;
  visibility: string;
  /** Max(created_at, max(updated_at) over artifacts). Server-supplied. */
  last_activity_at?: string | null;
}

export type SortMode = "activity" | "created";

export interface Run {
  run_id: string;
  experiment_id: string;
  run_index: number;
  status: string;
  label: string | null;
  started_at: string | null;
  finished_at: string | null;
  success: number | null;
  manifest_uri: string | null;
  zarr_root_uri: string | null;
  hparams_json: string | null;
  dataset_kinds: string | null;
}

export interface Comment {
  comment_id: string;
  experiment_id: string;
  author: string;
  body_markdown: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface Artifact {
  artifact_id: string;
  experiment_id: string;
  run_id: string | null;
  artifact_type: string;
  label: string | null;
  uri: string;
  content_hash: string | null;
  size_bytes: number | null;
  created_at: string;
}

// Auth: stored in localStorage
export function getAuth(): { apiKey: string; actor: string } | null {
  const apiKey = localStorage.getItem("strata_api_key");
  const actor = localStorage.getItem("strata_actor");
  if (!apiKey || !actor) return null;
  return { apiKey, actor };
}

export function setAuth(apiKey: string, actor: string) {
  localStorage.setItem("strata_api_key", apiKey);
  localStorage.setItem("strata_actor", actor);
}

export function clearAuth() {
  localStorage.removeItem("strata_api_key");
  localStorage.removeItem("strata_actor");
}

async function get<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_URL}${path}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

async function authFetch(path: string, options: RequestInit): Promise<Response> {
  const auth = getAuth();
  if (!auth) throw new Error("Not authenticated — set API key in settings");
  const resp = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${auth.apiKey}`,
      "X-Actor": auth.actor,
      ...options.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`API error ${resp.status}: ${body}`);
  }
  return resp;
}

export async function listExperiments(
  limit = 50,
  offset = 0,
  opts: { sort?: SortMode; author?: string | null } = {},
) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.author) params.set("author", opts.author);
  return get<{
    experiments: Experiment[];
    meta: { limit: number; offset: number; sort?: string; author?: string | null };
  }>(`/experiments?${params.toString()}`);
}

export async function getExperiment(slug: string) {
  return get<Experiment>(`/experiments/${slug}`);
}

export async function getExperimentRuns(slug: string) {
  return get<{ runs: Run[] }>(`/experiments/${slug}/runs`);
}

export async function getExperimentComments(slug: string) {
  return get<{ comments: Comment[] }>(`/experiments/${slug}/comments`);
}

export async function getExperimentArtifacts(slug: string) {
  return get<{ artifacts: Artifact[] }>(`/experiments/${slug}/artifacts`);
}

export async function getExperimentManifest(slug: string, run = 0) {
  return get<Record<string, unknown>>(`/experiments/${slug}/manifest?run=${run}`);
}

export async function searchExperiments(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return get<{ experiments: Experiment[]; meta: { limit: number; offset: number } }>(
    `/search?${query}`
  );
}

export async function updateNotes(slug: string, notes_markdown: string) {
  const resp = await authFetch(`/experiments/${slug}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes_markdown }),
  });
  return resp.json();
}

export async function addComment(slug: string, body_markdown: string) {
  const resp = await authFetch(`/experiments/${slug}/comments`, {
    method: "POST",
    body: JSON.stringify({ body_markdown }),
  });
  return resp.json();
}

export async function createExperiment(fields: {
  title: string;
  name?: string;
  group?: string;
  kind?: string;
  tags?: string[];
  intent?: string;
}): Promise<{ experiment_id: string; slug: string }> {
  const resp = await authFetch("/experiments/create", {
    method: "POST",
    body: JSON.stringify({
      kind: "single",
      tags: [],
      ...fields,
    }),
  });
  return resp.json();
}

export async function updateExperiment(slug: string, fields: { title?: string; group?: string | null; status?: string }) {
  const resp = await authFetch(`/experiments/${slug}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  return resp.json();
}

export async function deleteExperiment(slug: string) {
  const resp = await authFetch(`/experiments/${slug}`, { method: "DELETE" });
  return resp.json();
}

export async function deleteRun(slug: string, runIndex: number) {
  const resp = await authFetch(`/experiments/${slug}/runs/${runIndex}`, { method: "DELETE" });
  return resp.json();
}

export async function restoreRun(slug: string, runIndex: number) {
  const resp = await authFetch(`/experiments/${slug}/runs/${runIndex}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "initialised" }),
  });
  return resp.json();
}

export interface TrashedRun {
  run_id: string;
  experiment_id: string;
  run_index: number;
  label: string | null;
  status: string;
  experiment_slug: string;
  experiment_title: string;
}

export async function getTrash() {
  return get<{ experiments: Experiment[]; runs: TrashedRun[] }>("/experiments/trash");
}

export async function restoreExperiment(slug: string) {
  const resp = await authFetch(`/experiments/${slug}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
  return resp.json();
}
