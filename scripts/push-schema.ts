import { init, i } from "@instantdb/admin";

const APP_ID = "96df9811-8013-4bcf-b8ce-f7f1447ed2be";
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN || "06d04791-c8de-40a0-93a3-319a8edbefd8";

const schema = i.schema({
  entities: {
    experiments: i.entity({
      slug: i.string().unique().indexed(),
      title: i.string(),
      group: i.string().optional().indexed(),
      kind: i.string(),
      tags: i.json().optional(),
      status: i.string().indexed(),
      visibility: i.string(),
      intent: i.string().optional(),
      createdAt: i.number().indexed(),
      createdBy: i.string().indexed(),
      searchMeta: i.json().optional(),
      synthProbUri: i.string().optional(),
    }),
    runs: i.entity({
      runIndex: i.number().indexed(),
      status: i.string(),
      label: i.string().optional(),
      startedAt: i.number().optional(),
      finishedAt: i.number().optional(),
      hparamKeys: i.json().optional(),
      datasetKinds: i.json().optional(),
      hparamsUri: i.string().optional(),
      manifestUri: i.string().optional(),
      invocationsUri: i.string().optional(),
    }),
    artifacts: i.entity({
      artifactType: i.string().indexed(),
      label: i.string().indexed(),
      uri: i.string(),
      contentHash: i.string().optional(),
      sizeBytes: i.number().optional(),
      params: i.json().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().optional(),
    }),
    docs: i.entity({
      slug: i.string().unique().indexed(),
      title: i.string(),
      content: i.string(),
      updatedAt: i.number().indexed(),
      docId: i.string().optional(),
    }),
    comments: i.entity({
      author: i.string(),
      bodyMarkdown: i.string(),
      createdAt: i.number().indexed(),
      deletedAt: i.number().optional(),
    }),
    edges: i.entity({
      relation: i.string().indexed(),
      note: i.string().optional(),
      position: i.number().optional(),
      createdAt: i.number().optional(),
    }),
    draftPosts: i.entity({
      slug: i.string().unique().indexed(),
      title: i.string(),
      content: i.string(),
      updatedAt: i.number().indexed(),
      docId: i.string().indexed().optional(),
    }),
  },
  links: {
    experimentRuns: {
      forward: { on: "experiments", has: "many", label: "runs" },
      reverse: { on: "runs", has: "one", label: "experiment" },
    },
    runArtifacts: {
      forward: { on: "runs", has: "many", label: "artifacts" },
      reverse: { on: "artifacts", has: "one", label: "run" },
    },
    experimentComments: {
      forward: { on: "experiments", has: "many", label: "comments" },
      reverse: { on: "comments", has: "one", label: "experiment" },
    },
    edgeSourceExperiment: {
      forward: { on: "edges", has: "one", label: "sourceExperiment" },
      reverse: { on: "experiments", has: "many", label: "outEdges" },
    },
    edgeTargetExperiment: {
      forward: { on: "edges", has: "one", label: "targetExperiment" },
      reverse: { on: "experiments", has: "many", label: "inEdges" },
    },
    edgeSourceDoc: {
      forward: { on: "edges", has: "one", label: "sourceDoc" },
      reverse: { on: "docs", has: "many", label: "outEdges" },
    },
    edgeTargetDoc: {
      forward: { on: "edges", has: "one", label: "targetDoc" },
      reverse: { on: "docs", has: "many", label: "inEdges" },
    },
    edgeTargetArtifact: {
      forward: { on: "edges", has: "one", label: "targetArtifact" },
      reverse: { on: "artifacts", has: "many", label: "inEdges" },
    },
  },
});

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN, schema });

async function main() {
  console.log("Pushing schema to InstantDB app", APP_ID);

  // Test the connection by running a simple query
  try {
    const result = await db.query({ experiments: { $: { limit: 1 } } });
    console.log("Connection OK. Current experiments:", result.experiments?.length ?? 0);
    console.log("\nSchema is applied implicitly by the admin SDK on first use.");
    console.log("The schema was defined when init() was called — InstantDB creates");
    console.log("namespaces and attrs on first write if they don't exist.");
    console.log("\nReady to run sync-to-instant.ts");
  } catch (e: any) {
    console.error("Connection failed:", e.message);
    if (e.hint) console.error("Hint:", e.hint.message);
  }
}

main();
