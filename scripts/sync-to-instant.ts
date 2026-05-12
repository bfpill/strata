/**
 * Sync experiments from Billy's production Strata API into InstantDB.
 *
 * READ-ONLY on Billy's API. Only creates new nodes in InstantDB.
 * Never deletes or modifies anything. Safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/sync-to-instant.ts
 */

const STRATA_API = "https://strata.timaeus-research-inc.workers.dev";
const INSTANT_APP_ID = "96df9811-8013-4bcf-b8ce-f7f1447ed2be";
const INSTANT_ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN || "06d04791-c8de-40a0-93a3-319a8edbefd8";

import { init, id, tx } from "@instantdb/admin";

const idb = init({ appId: INSTANT_APP_ID, adminToken: INSTANT_ADMIN_TOKEN });

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function main() {
  console.log("Syncing from", STRATA_API, "→ InstantDB\n");

  // Fetch all experiments
  const allExperiments: any[] = [];
  let offset = 0;
  while (true) {
    const { experiments } = await fetchJson(`${STRATA_API}/experiments?limit=50&offset=${offset}`);
    allExperiments.push(...experiments);
    if (experiments.length < 50) break;
    offset += 50;
  }
  console.log(`${allExperiments.length} experiments in Strata API`);

  // Check existing
  const existing = await idb.query({ experiments: {} });
  const existingSlugs = new Set((existing.experiments ?? []).map((e: any) => e.slug));
  console.log(`${existingSlugs.size} already in InstantDB\n`);

  let syncedExps = 0;
  let totalRuns = 0;
  let totalArts = 0;

  for (const exp of allExperiments) {
    if (existingSlugs.has(exp.slug)) continue;

    let tags: string[] = [];
    try { tags = JSON.parse(exp.tags || "[]"); } catch {}

    // Build one big batch transaction for the entire experiment
    const ops: any[] = [];
    const expId = id();

    ops.push(
      tx.experiments[expId].update({
        slug: exp.slug,
        title: exp.title || exp.slug,
        group: exp.group || "",
        kind: exp.kind || "single",
        tags,
        status: exp.status || "active",
        visibility: exp.visibility || "public",
        intent: exp.intent || "",
        createdAt: new Date(exp.created_at).getTime(),
        createdBy: exp.created_by || "unknown",
        synthProbUri: exp.synth_prob_json ? `experiments/${exp.slug}/synth_prob.json` : "",
      })
    );

    // Fetch runs
    const runIdMap = new Map<string, string>();
    try {
      const { runs } = await fetchJson(`${STRATA_API}/experiments/${exp.slug}/runs`);
      for (const run of runs) {
        if (run.status === "tombstoned") continue;
        const runId = id();
        runIdMap.set(run.run_id, runId);

        let hparamKeys: any = null;
        try { hparamKeys = JSON.parse(run.hparams_json || "null"); } catch {}
        let datasetKinds: any = null;
        try { datasetKinds = JSON.parse(run.dataset_kinds || "null"); } catch {}

        ops.push(
          tx.runs[runId].update({
            runIndex: run.run_index,
            status: run.status || "initialised",
            label: run.label || "",
            startedAt: run.started_at ? new Date(run.started_at).getTime() : null,
            finishedAt: run.finished_at ? new Date(run.finished_at).getTime() : null,
            hparamKeys,
            datasetKinds,
          }).link({ experiment: expId })
        );
        totalRuns++;
      }
    } catch {}

    // Fetch artifacts
    let artCount = 0;
    try {
      const { artifacts } = await fetchJson(`${STRATA_API}/experiments/${exp.slug}/artifacts`);
      for (const art of artifacts) {
        const artId = id();
        let params: any = null;
        try { params = JSON.parse(art.params_json || "null"); } catch {}

        const artTx = tx.artifacts[artId].update({
          artifactType: art.artifact_type || "unknown",
          label: art.label || "",
          uri: art.uri || "",
          contentHash: art.content_hash || null,
          sizeBytes: art.size_bytes || null,
          params,
          createdAt: new Date(art.created_at).getTime(),
        });

        const runInstantId = art.run_id ? runIdMap.get(art.run_id) : null;
        ops.push(runInstantId ? artTx.link({ run: runInstantId }) : artTx);
        artCount++;
        totalArts++;
      }
    } catch {}

    // Commit entire experiment as one batch
    try {
      // InstantDB has a transaction size limit, batch in chunks of 200
      for (let i = 0; i < ops.length; i += 200) {
        await idb.transact(ops.slice(i, i + 200));
      }
      syncedExps++;
      console.log(`✓ ${exp.slug}: ${runIdMap.size} runs, ${artCount} artifacts`);
    } catch (e: any) {
      console.log(`✗ ${exp.slug}: ${e.message?.slice(0, 80)}`);
    }
  }

  console.log(`\n${"─".repeat(40)}`);
  console.log(`Synced: ${syncedExps} experiments, ${totalRuns} runs, ${totalArts} artifacts`);
  console.log(`Skipped: ${existingSlugs.size} (already existed)`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
