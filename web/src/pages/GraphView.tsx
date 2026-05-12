import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import db from "../lib/db";
import {
  listExperiments,
  getExperimentRuns,
  getExperimentArtifacts,
  type Experiment,
  type Run,
  type Artifact,
} from "../api";

interface GraphNode {
  id: string;
  label: string;
  type: "experiment" | "run" | "artifact" | "doc";
  slug?: string;
  color: string;
  val: number;
}

interface GraphLink {
  source: string;
  target: string;
  relation: string;
  color: string;
}

const NODE_COLORS: Record<string, string> = {
  experiment: "#3b82f6",
  run: "#8b5cf6",
  artifact: "#f59e0b",
  doc: "#10b981",
};

export function GraphView() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [runsByExp, setRunsByExp] = useState<Record<string, Run[]>>({});
  const [artifactsByExp, setArtifactsByExp] = useState<Record<string, Artifact[]>>({});
  const [loading, setLoading] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // Load docs from InstantDB
  const { data: docsData } = db.useQuery({ draftPosts: {} });
  const docs = docsData?.draftPosts ?? [];

  // Load experiments from API
  useEffect(() => {
    (async () => {
      try {
        const result = await listExperiments(100, 0);
        setExperiments(result.experiments);

        const runsMap: Record<string, Run[]> = {};
        const artsMap: Record<string, Artifact[]> = {};
        await Promise.all(
          result.experiments.map(async (exp) => {
            try {
              const [runsRes, artsRes] = await Promise.all([
                getExperimentRuns(exp.slug),
                getExperimentArtifacts(exp.slug),
              ]);
              runsMap[exp.slug] = runsRes.runs;
              artsMap[exp.slug] = artsRes.artifacts;
            } catch {}
          })
        );
        setRunsByExp(runsMap);
        setArtifactsByExp(artsMap);
      } catch {}
      setLoading(false);
    })();
  }, []);

  // Resize
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: window.innerHeight - 120,
        });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    // Experiment nodes
    experiments.forEach((exp) => {
      nodes.push({
        id: `exp:${exp.slug}`,
        label: exp.title,
        type: "experiment",
        slug: exp.slug,
        color: NODE_COLORS.experiment,
        val: 8,
      });

      // Run nodes + links
      const runs = runsByExp[exp.slug] ?? [];
      runs.forEach((run) => {
        const runId = `run:${exp.slug}:${run.run_index}`;
        nodes.push({
          id: runId,
          label: run.label || `Run ${run.run_index}`,
          type: "run",
          color: NODE_COLORS.run,
          val: 4,
        });
        links.push({
          source: `exp:${exp.slug}`,
          target: runId,
          relation: "has_run",
          color: "#c4b5fd",
        });
      });

      // Artifact nodes + links
      const artifacts = artifactsByExp[exp.slug] ?? [];
      artifacts.forEach((art) => {
        const artId = `art:${art.artifact_id}`;
        nodes.push({
          id: artId,
          label: art.label || art.artifact_type,
          type: "artifact",
          color: NODE_COLORS.artifact,
          val: 3,
        });
        // Link to run if available, otherwise to experiment
        const matchingRun = runs.find((r) => r.run_id === art.run_id);
        if (matchingRun) {
          links.push({
            source: `run:${exp.slug}:${matchingRun.run_index}`,
            target: artId,
            relation: "has_artifact",
            color: "#fcd34d",
          });
        } else {
          links.push({
            source: `exp:${exp.slug}`,
            target: artId,
            relation: "has_artifact",
            color: "#fcd34d",
          });
        }
      });

      // Doc links (from doc_slugs)
      if (exp.doc_slugs) {
        try {
          const docSlugs: string[] = JSON.parse(exp.doc_slugs);
          docSlugs.forEach((ds) => {
            const docId = `doc:${ds}`;
            links.push({
              source: docId,
              target: `exp:${exp.slug}`,
              relation: "discusses",
              color: "#6ee7b7",
            });
          });
        } catch {}
      }
    });

    // Doc nodes
    docs.forEach((doc: { slug: string; title: string }) => {
      const docId = `doc:${doc.slug}`;
      if (!nodes.find((n) => n.id === docId)) {
        nodes.push({
          id: docId,
          label: doc.title || doc.slug,
          type: "doc",
          slug: doc.slug,
          color: NODE_COLORS.doc,
          val: 6,
        });
      }
    });

    // Also add doc nodes referenced by experiments but not in InstantDB
    links.forEach((l) => {
      const src = typeof l.source === "string" ? l.source : (l.source as any).id;
      if (src.startsWith("doc:") && !nodes.find((n) => n.id === src)) {
        const slug = src.replace("doc:", "");
        nodes.push({
          id: src,
          label: slug,
          type: "doc",
          slug,
          color: NODE_COLORS.doc,
          val: 6,
        });
      }
    });

    return { nodes, links };
  }, [experiments, runsByExp, artifactsByExp, docs]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.type === "experiment" && node.slug) {
        navigate(`/e/${node.slug}`);
      } else if (node.type === "doc" && node.slug) {
        navigate(`/doc/${node.slug}`);
      }
    },
    [navigate]
  );

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = node.val || 4;
      const fontSize = Math.max(10 / globalScale, 1.5);
      const isHovered = hoveredNode?.id === node.id;

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = isHovered ? 1 : 0.85;
      ctx.fill();

      // Hover ring
      if (isHovered) {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Label
      if (globalScale > 0.7 || isHovered) {
        ctx.globalAlpha = isHovered ? 1 : 0.7;
        ctx.font = `${isHovered ? "bold " : ""}${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#374151";
        const label =
          node.label.length > 30
            ? node.label.slice(0, 28) + "…"
            : node.label;
        ctx.fillText(label, node.x, node.y + size + 2);
      }
      ctx.globalAlpha = 1;
    },
    [hoveredNode]
  );

  return (
    <div className="strata" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid #e5e7eb", padding: "0.5rem 1.5rem", display: "flex", alignItems: "center", gap: "1rem", background: "white" }}>
        <Link to="/" style={{ color: "#6b7280", fontSize: "0.85rem" }}>← Feed</Link>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Graph</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.75rem" }}>
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <span key={type} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
              {type}
            </span>
          ))}
          <span style={{ color: "#9ca3af" }}>
            {graphData.nodes.length} nodes · {graphData.links.length} edges
          </span>
        </div>
      </header>

      <div ref={containerRef} style={{ flex: 1, position: "relative" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#6b7280", fontSize: "0.85rem" }}>
            Loading graph...
          </div>
        ) : (
          <ForceGraph2D
            graphData={graphData}
            width={dimensions.width}
            height={dimensions.height}
            nodeCanvasObject={paintNode}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.beginPath();
              ctx.arc(node.x, node.y, node.val + 4, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            onNodeClick={handleNodeClick as any}
            onNodeHover={(node: any) => setHoveredNode(node)}
            linkColor={(link: any) => link.color || "#e5e7eb"}
            linkWidth={1.5}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={0.9}
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            backgroundColor="#fafafa"
          />
        )}

        {/* Hover tooltip */}
        {hoveredNode && (
          <div style={{
            position: "absolute", top: 12, right: 12, background: "white", border: "1px solid #e5e7eb",
            borderRadius: 8, padding: "0.75rem 1rem", fontSize: "0.8rem", maxWidth: 280, boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: hoveredNode.color }}>
              {hoveredNode.type}
            </div>
            <div style={{ color: "#374151" }}>{hoveredNode.label}</div>
            {hoveredNode.slug && (
              <div style={{ color: "#9ca3af", fontSize: "0.7rem", fontFamily: "monospace", marginTop: "0.15rem" }}>
                {hoveredNode.slug}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
