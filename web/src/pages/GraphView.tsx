import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import db from "../lib/db";
import {
  getExperiment,
  getExperimentRuns,
  getExperimentArtifacts,
  type Experiment,
  type Run,
  type Artifact,
} from "../api";

interface GraphNode {
  id: string;
  label: string;
  type: "experiment" | "run" | "doc";
  slug?: string;
  group?: string;
  color: string;
  val: number;
}

interface GraphLink {
  source: string;
  target: string;
  color: string;
}

const NODE_COLORS: Record<string, string> = {
  experiment: "#3b82f6",
  run: "#8b5cf6",
  doc: "#10b981",
};

const GROUP_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

function parseTags(s: string): string[] {
  try { return JSON.parse(s); } catch { return []; }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Side Panel ──────────────────────────────────────────────

function NodePanel({ node, onClose, onFullscreen }: {
  node: GraphNode;
  onClose: () => void;
  onFullscreen: () => void;
}) {
  const [exp, setExp] = useState<Experiment | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (node.type !== "experiment" || !node.slug) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      getExperiment(node.slug).catch(() => null),
      getExperimentRuns(node.slug).catch(() => ({ runs: [] })),
      getExperimentArtifacts(node.slug).catch(() => ({ artifacts: [] })),
    ]).then(([e, r, a]) => {
      setExp(e);
      setRuns(r.runs);
      setArtifacts(a.artifacts);
      setLoading(false);
    });
  }, [node.slug, node.type]);

  return (
    <div style={{
      width: 380, borderLeft: "1px solid #e5e7eb", background: "white",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "0.6rem 1rem", borderBottom: "1px solid #e5e7eb",
        display: "flex", alignItems: "center", gap: "0.5rem",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: node.color, flexShrink: 0 }} />
        <span style={{ fontSize: "0.85rem", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.label}
        </span>
        <button onClick={onFullscreen} style={{
          background: "none", border: "1px solid #d1d5db", borderRadius: 4,
          padding: "0.15rem 0.5rem", fontSize: "0.7rem", cursor: "pointer", color: "#374151",
        }}>
          Open ↗
        </button>
        <button onClick={onClose} style={{
          background: "none", border: "none", fontSize: "1rem", cursor: "pointer", color: "#9ca3af", padding: "0 0.25rem",
        }}>
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem 1rem", fontSize: "0.8rem" }}>
        {node.type === "doc" && (
          <div>
            <div style={{ color: "#6b7280", marginBottom: "0.5rem" }}>Document</div>
            <code style={{ fontSize: "0.75rem", color: "#374151", background: "#f3f4f6", padding: "0.15rem 0.4rem", borderRadius: 3 }}>
              {node.slug}
            </code>
          </div>
        )}

        {node.type === "experiment" && loading && (
          <div style={{ color: "#6b7280" }}>Loading...</div>
        )}

        {node.type === "experiment" && exp && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {/* Meta */}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <tbody>
                {exp.group && <tr><td style={{ color: "#6b7280", padding: "0.15rem 0.4rem 0.15rem 0", whiteSpace: "nowrap" }}>Group</td><td style={{ color: "#374151" }}>{exp.group}</td></tr>}
                <tr><td style={{ color: "#6b7280", padding: "0.15rem 0.4rem 0.15rem 0" }}>Status</td><td><span style={{ background: "#d1fae5", color: "#065f46", padding: "0.1rem 0.4rem", borderRadius: 3, fontSize: "0.7rem" }}>{exp.status}</span></td></tr>
                <tr><td style={{ color: "#6b7280", padding: "0.15rem 0.4rem 0.15rem 0" }}>Created</td><td style={{ color: "#374151" }}>{timeAgo(exp.created_at)} by {exp.created_by}</td></tr>
                <tr><td style={{ color: "#6b7280", padding: "0.15rem 0.4rem 0.15rem 0" }}>Kind</td><td style={{ color: "#374151" }}>{exp.kind}</td></tr>
              </tbody>
            </table>

            {/* Tags */}
            {exp.tags && parseTags(exp.tags).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                {parseTags(exp.tags).map(t => (
                  <span key={t} style={{ background: "#eff6ff", color: "#2563eb", fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: 9999 }}>{t}</span>
                ))}
              </div>
            )}

            {/* Intent */}
            {exp.intent && (
              <div>
                <div style={{ color: "#6b7280", fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.2rem" }}>Intent</div>
                <div style={{ color: "#374151", lineHeight: 1.4 }}>{exp.intent}</div>
              </div>
            )}

            {/* Runs */}
            <div>
              <div style={{ color: "#6b7280", fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.3rem" }}>
                Runs ({runs.length})
              </div>
              {runs.slice(0, 10).map(r => (
                <div key={r.run_id} style={{
                  padding: "0.25rem 0.4rem", borderBottom: "1px solid #f3f4f6",
                  display: "flex", alignItems: "center", gap: "0.4rem",
                }}>
                  <span style={{ fontSize: "0.65rem", color: "#9ca3af" }}>#{r.run_index}</span>
                  <span style={{ color: "#374151", flex: 1 }}>{r.label || `Run ${r.run_index}`}</span>
                  <span style={{
                    fontSize: "0.65rem", padding: "0.05rem 0.3rem", borderRadius: 3,
                    background: r.status === "finalized" ? "#d1fae5" : "#e5e7eb",
                    color: r.status === "finalized" ? "#065f46" : "#374151",
                  }}>{r.status}</span>
                </div>
              ))}
              {runs.length > 10 && <div style={{ color: "#9ca3af", fontSize: "0.7rem", padding: "0.25rem 0" }}>+{runs.length - 10} more</div>}
            </div>

            {/* Artifacts summary */}
            <div>
              <div style={{ color: "#6b7280", fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.2rem" }}>
                Artifacts ({artifacts.length})
              </div>
              {artifacts.length > 0 && (
                <div style={{ color: "#374151", fontSize: "0.75rem" }}>
                  {[...new Set(artifacts.map(a => a.label).filter(Boolean))].slice(0, 8).join(", ")}
                  {artifacts.length > 8 && ` +${artifacts.length - 8} more`}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────

export function GraphView() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [colorByGroup, setColorByGroup] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = db.useQuery({ experiments: { runs: {} } } as any);
  const { data: docsData } = db.useQuery({ draftPosts: {} });

  const experiments = (data as any)?.experiments ?? [];
  const docs = docsData?.draftPosts ?? [];

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const panelWidth = selectedNode ? 380 : 0;
        setDimensions({
          width: containerRef.current.clientWidth - panelWidth,
          height: window.innerHeight - 48,
        });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [selectedNode]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    experiments.forEach((e: any) => { if (e.group) set.add(e.group); });
    return [...set].sort();
  }, [experiments]);

  const groupColor = useCallback((group: string) => {
    const idx = groups.indexOf(group);
    return idx >= 0 ? GROUP_COLORS[idx % GROUP_COLORS.length] : NODE_COLORS.experiment;
  }, [groups]);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    experiments.forEach((exp: any) => {
      const color = colorByGroup && exp.group ? groupColor(exp.group) : NODE_COLORS.experiment;
      nodes.push({
        id: `exp:${exp.id}`,
        label: exp.title || exp.slug,
        type: "experiment",
        slug: exp.slug,
        group: exp.group,
        color,
        val: 6,
      });

      if (showRuns && exp.runs) {
        exp.runs.forEach((run: any) => {
          const runId = `run:${run.id}`;
          nodes.push({ id: runId, label: run.label || `Run ${run.runIndex}`, type: "run", color: NODE_COLORS.run, val: 3 });
          links.push({ source: `exp:${exp.id}`, target: runId, color: "#c4b5fd" });
        });
      }
    });

    if (colorByGroup) {
      const byGroup = new Map<string, string[]>();
      experiments.forEach((exp: any) => {
        if (!exp.group) return;
        const list = byGroup.get(exp.group) || [];
        list.push(`exp:${exp.id}`);
        byGroup.set(exp.group, list);
      });
      byGroup.forEach((ids) => {
        for (let i = 1; i < ids.length; i++) {
          links.push({ source: ids[0], target: ids[i], color: "#e5e7eb" });
        }
      });
    }

    docs.forEach((doc: any) => {
      nodes.push({ id: `doc:${doc.id}`, label: doc.title || doc.slug, type: "doc", slug: doc.slug, color: NODE_COLORS.doc, val: 5 });
    });

    return { nodes, links };
  }, [experiments, docs, showRuns, colorByGroup, groupColor]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!selectedNode) return;
    if (selectedNode.type === "experiment" && selectedNode.slug) navigate(`/e/${selectedNode.slug}`);
    else if (selectedNode.type === "doc" && selectedNode.slug) navigate(`/doc/${selectedNode.slug}`);
  }, [selectedNode, navigate]);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = node.val || 4;
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedNode?.id === node.id;
      const fontSize = Math.max(10 / globalScale, 1.5);

      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = isHovered || isSelected ? 1 : 0.85;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#1d4ed8";
        ctx.lineWidth = 3 / globalScale;
        ctx.stroke();
      } else if (isHovered) {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      if (globalScale > 1.2 || isHovered || isSelected) {
        ctx.globalAlpha = isHovered || isSelected ? 1 : 0.6;
        ctx.font = `${isHovered || isSelected ? "bold " : ""}${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#374151";
        const label = node.label.length > 35 ? node.label.slice(0, 33) + "…" : node.label;
        ctx.fillText(label, node.x, node.y + size + 2);
      }
      ctx.globalAlpha = 1;
    },
    [hoveredNode, selectedNode]
  );

  return (
    <div className="strata" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{
        borderBottom: "1px solid #e5e7eb", padding: "0.4rem 1rem",
        display: "flex", alignItems: "center", gap: "0.75rem", background: "white", height: 48,
      }}>
        <Link to="/" style={{ color: "#6b7280", fontSize: "0.85rem" }}>← Feed</Link>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Graph</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.7rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input type="checkbox" checked={showRuns} onChange={e => setShowRuns(e.target.checked)} />
            Runs
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input type="checkbox" checked={colorByGroup} onChange={e => setColorByGroup(e.target.checked)} />
            Groups
          </label>
          <span style={{ color: "#d1d5db" }}>|</span>
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <span key={type} style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
              {type}
            </span>
          ))}
          <span style={{ color: "#9ca3af" }}>{graphData.nodes.length} nodes</span>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div ref={containerRef} style={{ flex: 1, position: "relative" }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#6b7280" }}>
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
                ctx.arc(node.x, node.y, (node.val || 4) + 4, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              onNodeClick={handleNodeClick as any}
              onNodeHover={(node: any) => setHoveredNode(node)}
              onBackgroundClick={() => setSelectedNode(null)}
              linkColor={(link: any) => link.color || "#e5e7eb"}
              linkWidth={0.8}
              cooldownTicks={100}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              backgroundColor="#fafafa"
            />
          )}
        </div>

        {selectedNode && (
          <NodePanel
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            onFullscreen={handleFullscreen}
          />
        )}
      </div>
    </div>
  );
}
