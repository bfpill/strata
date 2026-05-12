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
import ReactMarkdown from "react-markdown";

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
  "#14b8a6", "#a855f7", "#f43f5e", "#0ea5e9", "#d946ef",
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

function parseHparams(json: string | null): Record<string, any> | null {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

// ── Single Node Panel ───────────────────────────────────────

function NodePanel({ node, onClose, onFullscreen }: {
  node: GraphNode; onClose: () => void; onFullscreen: () => void;
}) {
  const [exp, setExp] = useState<Experiment | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);

  useEffect(() => {
    if (node.type !== "experiment" || !node.slug) { setLoading(false); return; }
    setLoading(true);
    setExpandedRun(null);
    Promise.all([
      getExperiment(node.slug).catch(() => null),
      getExperimentRuns(node.slug).catch(() => ({ runs: [] })),
      getExperimentArtifacts(node.slug).catch(() => ({ artifacts: [] })),
    ]).then(([e, r, a]) => {
      setExp(e); setRuns(r.runs); setArtifacts(a.artifacts); setLoading(false);
    });
  }, [node.slug, node.type]);

  const artifactsByType = useMemo(() => {
    const m = new Map<string, number>();
    artifacts.forEach(a => m.set(a.artifact_type, (m.get(a.artifact_type) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [artifacts]);

  return (
    <div style={{ width: 400, borderLeft: "1px solid #e5e7eb", background: "white", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: node.color, flexShrink: 0 }} />
        <span style={{ fontSize: "0.85rem", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
        <button onClick={onFullscreen} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 4, padding: "0.15rem 0.5rem", fontSize: "0.7rem", cursor: "pointer", color: "#374151" }}>Open ↗</button>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1rem", cursor: "pointer", color: "#9ca3af" }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem", fontSize: "0.78rem" }}>
        {node.type === "doc" && (
          <div><div style={{ color: "#6b7280", marginBottom: "0.5rem" }}>Document</div>
            <code style={{ fontSize: "0.75rem", color: "#374151", background: "#f3f4f6", padding: "0.15rem 0.4rem", borderRadius: 3 }}>{node.slug}</code>
          </div>
        )}

        {node.type === "experiment" && loading && <div style={{ color: "#6b7280" }}>Loading...</div>}

        {node.type === "experiment" && exp && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#9ca3af" }}>{exp.slug}</div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
              <tbody>
                {exp.group && <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Group</td><td style={{ color: "#374151", fontWeight: 500 }}>{exp.group}</td></tr>}
                <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Status</td><td><span style={{ background: exp.status === "active" ? "#d1fae5" : "#e5e7eb", color: exp.status === "active" ? "#065f46" : "#374151", padding: "0.08rem 0.35rem", borderRadius: 3, fontSize: "0.68rem" }}>{exp.status}</span></td></tr>
                <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Created</td><td style={{ color: "#374151" }}>{timeAgo(exp.created_at)} by {exp.created_by}</td></tr>
                <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Kind</td><td style={{ color: "#374151" }}>{exp.kind}</td></tr>
                <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Runs</td><td style={{ color: "#374151" }}>{runs.length}</td></tr>
                <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Artifacts</td><td style={{ color: "#374151" }}>{artifacts.length}</td></tr>
              </tbody>
            </table>

            {exp.tags && parseTags(exp.tags).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                {parseTags(exp.tags).map(t => (
                  <span key={t} style={{ background: "#eff6ff", color: "#2563eb", fontSize: "0.65rem", padding: "0.08rem 0.35rem", borderRadius: 9999 }}>{t}</span>
                ))}
              </div>
            )}

            {exp.intent && (
              <div style={{ color: "#374151", lineHeight: 1.4, borderLeft: "2px solid #e5e7eb", paddingLeft: "0.5rem" }}>{exp.intent}</div>
            )}

            {exp.notes_markdown && (
              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: "0.5rem" }}>
                <div style={{ color: "#6b7280", fontSize: "0.68rem", fontWeight: 600, marginBottom: "0.2rem" }}>Notes</div>
                <div style={{ color: "#374151", lineHeight: 1.4, fontSize: "0.75rem" }}>
                  <ReactMarkdown>{exp.notes_markdown.slice(0, 500)}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Artifact types breakdown */}
            {artifactsByType.length > 0 && (
              <div>
                <div style={{ color: "#6b7280", fontSize: "0.68rem", fontWeight: 600, marginBottom: "0.2rem" }}>Artifact Types</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                  {artifactsByType.map(([type, count]) => (
                    <span key={type} style={{ background: "#fef3c7", color: "#92400e", fontSize: "0.65rem", padding: "0.08rem 0.35rem", borderRadius: 3 }}>
                      {type} ×{count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Runs with expandable hparams */}
            <div>
              <div style={{ color: "#6b7280", fontSize: "0.68rem", fontWeight: 600, marginBottom: "0.2rem" }}>Runs</div>
              {runs.map(r => {
                const hparams = parseHparams(r.hparams_json);
                const isExpanded = expandedRun === r.run_index;
                return (
                  <div key={r.run_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <div
                      onClick={() => setExpandedRun(isExpanded ? null : r.run_index)}
                      style={{ padding: "0.25rem 0", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}
                    >
                      <span style={{ fontSize: "0.6rem", color: "#9ca3af", width: "1.5em" }}>{isExpanded ? "▼" : "▶"}</span>
                      <span style={{ fontSize: "0.6rem", color: "#9ca3af" }}>#{r.run_index}</span>
                      <span style={{ color: "#374151", flex: 1 }}>{r.label || `Run ${r.run_index}`}</span>
                      <span style={{ fontSize: "0.6rem", padding: "0.04rem 0.25rem", borderRadius: 3, background: r.status === "finalized" ? "#d1fae5" : "#e5e7eb", color: r.status === "finalized" ? "#065f46" : "#374151" }}>{r.status}</span>
                    </div>
                    {isExpanded && hparams && (
                      <div style={{ paddingLeft: "1.5em", paddingBottom: "0.3rem" }}>
                        <table style={{ borderCollapse: "collapse", fontSize: "0.7rem", width: "100%" }}>
                          <tbody>
                            {Object.entries(hparams).slice(0, 15).map(([k, v]) => (
                              <tr key={k}>
                                <td style={{ color: "#6b7280", padding: "0.08rem 0.3rem 0.08rem 0", whiteSpace: "nowrap", fontFamily: "monospace" }}>{k}</td>
                                <td style={{ color: "#374151", fontFamily: "monospace", wordBreak: "break-all" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Multi-Selection Summary ─────────────────────────────────

function SelectionPanel({ nodes, onClose }: { nodes: GraphNode[]; onClose: () => void }) {
  const experiments = nodes.filter(n => n.type === "experiment");
  const runNodes = nodes.filter(n => n.type === "run");
  const docNodes = nodes.filter(n => n.type === "doc");

  const groups = [...new Set(experiments.map(e => e.group).filter(Boolean))];

  return (
    <div style={{ width: 400, borderLeft: "1px solid #e5e7eb", background: "white", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600, flex: 1 }}>Selection ({nodes.length} nodes)</span>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1rem", cursor: "pointer", color: "#9ca3af" }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem", fontSize: "0.78rem" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem", marginBottom: "0.75rem" }}>
          <tbody>
            <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Experiments</td><td style={{ color: "#374151", fontWeight: 500 }}>{experiments.length}</td></tr>
            {runNodes.length > 0 && <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Runs</td><td style={{ color: "#374151" }}>{runNodes.length}</td></tr>}
            {docNodes.length > 0 && <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Docs</td><td style={{ color: "#374151" }}>{docNodes.length}</td></tr>}
            {groups.length > 0 && <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Groups</td><td style={{ color: "#374151" }}>{groups.join(", ")}</td></tr>}
          </tbody>
        </table>

        {experiments.length > 0 && (
          <div>
            <div style={{ color: "#6b7280", fontSize: "0.68rem", fontWeight: 600, marginBottom: "0.3rem" }}>Experiments</div>
            {experiments.map(e => (
              <div key={e.id} style={{ padding: "0.2rem 0", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: e.color, flexShrink: 0 }} />
                <span style={{ color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</span>
                {e.group && <span style={{ fontSize: "0.6rem", color: "#9ca3af" }}>{e.group}</span>}
              </div>
            ))}
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
  const [selectedNodes, setSelectedNodes] = useState<GraphNode[]>([]);
  const [showRuns, setShowRuns] = useState(false);
  const [colorByGroup, setColorByGroup] = useState(true);

  // Drag selection state
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const isDragging = dragStart && dragEnd;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = db.useQuery({ experiments: { runs: {} } } as any);
  const { data: docsData } = db.useQuery({ draftPosts: {} });
  const experiments = (data as any)?.experiments ?? [];
  const docs = docsData?.draftPosts ?? [];

  const hasPanel = selectedNode || selectedNodes.length > 0;

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: window.innerHeight - 48,
        });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

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
      nodes.push({ id: `exp:${exp.id}`, label: exp.title || exp.slug, type: "experiment", slug: exp.slug, group: exp.group, color, val: 6 });
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
      byGroup.forEach((ids) => { for (let i = 1; i < ids.length; i++) links.push({ source: ids[0], target: ids[i], color: "#e5e7eb" }); });
    }

    docs.forEach((doc: any) => {
      nodes.push({ id: `doc:${doc.id}`, label: doc.title || doc.slug, type: "doc", slug: doc.slug, color: NODE_COLORS.doc, val: 5 });
    });

    return { nodes, links };
  }, [experiments, docs, showRuns, colorByGroup, groupColor]);

  const graphRef = useRef<any>(null);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNodes([]);
    setSelectedNode(node);
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!selectedNode) return;
    if (selectedNode.type === "experiment" && selectedNode.slug) navigate(`/e/${selectedNode.slug}`);
    else if (selectedNode.type === "doc" && selectedNode.slug) navigate(`/doc/${selectedNode.slug}`);
  }, [selectedNode, navigate]);

  const closePanel = useCallback(() => {
    setSelectedNode(null);
    setSelectedNodes([]);
  }, []);

  // Handle drag selection on the container
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.shiftKey) {
      setDragStart({ x: e.clientX, y: e.clientY });
      setDragEnd(null);
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStart && e.shiftKey) {
      setDragEnd({ x: e.clientX, y: e.clientY });
    }
  }, [dragStart]);

  const handleMouseUp = useCallback((_e: React.MouseEvent) => {
    if (dragStart && dragEnd && graphRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x1 = Math.min(dragStart.x, dragEnd.x) - rect.left;
      const x2 = Math.max(dragStart.x, dragEnd.x) - rect.left;
      const y1 = Math.min(dragStart.y, dragEnd.y) - rect.top;
      const y2 = Math.max(dragStart.y, dragEnd.y) - rect.top;

      const graph = graphRef.current;
      const selected = graphData.nodes.filter((node: any) => {
        const coords = graph.graph2ScreenCoords(node.x, node.y);
        return coords.x >= x1 && coords.x <= x2 && coords.y >= y1 && coords.y <= y2;
      });

      if (selected.length > 0) {
        setSelectedNode(null);
        setSelectedNodes(selected);
      }
    }
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd, graphData.nodes]);

  const selectedIds = useMemo(() => new Set([
    ...(selectedNode ? [selectedNode.id] : []),
    ...selectedNodes.map(n => n.id),
  ]), [selectedNode, selectedNodes]);

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = node.val || 4;
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedIds.has(node.id);
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
    [hoveredNode, selectedIds]
  );

  return (
    <div className="strata" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid #e5e7eb", padding: "0.4rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem", background: "white", height: 48 }}>
        <Link to="/" style={{ color: "#6b7280", fontSize: "0.85rem" }}>← Feed</Link>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Graph</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.7rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input type="checkbox" checked={showRuns} onChange={e => setShowRuns(e.target.checked)} /> Runs
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}>
            <input type="checkbox" checked={colorByGroup} onChange={e => setColorByGroup(e.target.checked)} /> Groups
          </label>
          <span style={{ color: "#d1d5db" }}>|</span>
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <span key={type} style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} /> {type}
            </span>
          ))}
          <span style={{ color: "#9ca3af" }}>{graphData.nodes.length} nodes</span>
          <span style={{ color: "#c4b5fd", fontSize: "0.65rem" }}>Shift+drag to select</span>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div
          ref={containerRef}
          style={{ flex: 1, position: "relative", cursor: dragStart ? "crosshair" : undefined }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#6b7280" }}>Loading graph...</div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={hasPanel ? dimensions.width - 400 : dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.beginPath(); ctx.arc(node.x, node.y, (node.val || 4) + 4, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill();
              }}
              onNodeClick={handleNodeClick as any}
              onNodeHover={(node: any) => setHoveredNode(node)}
              onBackgroundClick={closePanel}
              linkColor={(link: any) => link.color || "#e5e7eb"}
              linkWidth={0.8}
              cooldownTicks={100}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              backgroundColor="#fafafa"
            />
          )}

          {/* Drag selection box */}
          {isDragging && containerRef.current && (() => {
            const rect = containerRef.current.getBoundingClientRect();
            const x = Math.min(dragStart.x, dragEnd!.x) - rect.left;
            const y = Math.min(dragStart.y, dragEnd!.y) - rect.top;
            const w = Math.abs(dragEnd!.x - dragStart.x);
            const h = Math.abs(dragEnd!.y - dragStart.y);
            return <div style={{ position: "absolute", left: x, top: y, width: w, height: h, border: "2px dashed #3b82f6", background: "rgba(59,130,246,0.08)", pointerEvents: "none" }} />;
          })()}

          {/* Hover tooltip */}
          {hoveredNode && !selectedNode && selectedNodes.length === 0 && (
            <div style={{ position: "absolute", top: 8, right: 8, background: "white", border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.5rem 0.75rem", fontSize: "0.75rem", maxWidth: 260, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 600, color: hoveredNode.color }}>{hoveredNode.type}</div>
              <div style={{ color: "#374151" }}>{hoveredNode.label}</div>
              {hoveredNode.group && <div style={{ color: "#9ca3af", fontSize: "0.65rem" }}>{hoveredNode.group}</div>}
            </div>
          )}
        </div>

        {selectedNode && (
          <NodePanel node={selectedNode} onClose={closePanel} onFullscreen={handleFullscreen} />
        )}
        {selectedNodes.length > 0 && !selectedNode && (
          <SelectionPanel nodes={selectedNodes} onClose={closePanel} />
        )}
      </div>
    </div>
  );
}
