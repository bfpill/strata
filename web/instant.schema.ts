import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    // ── Core nodes ─────────────────────────────────────

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

    // Keep draftPosts for backwards compat with existing Google Docs sync
    draftPosts: i.entity({
      slug: i.string().unique().indexed(),
      title: i.string(),
      content: i.string(),
      updatedAt: i.number().indexed(),
      docId: i.string().indexed().optional(),
    }),
  },

  links: {
    // ── Hierarchical ───────────────────────────────────
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

    // ── Typed edges (generic graph relationships) ──────
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

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
