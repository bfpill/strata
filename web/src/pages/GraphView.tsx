import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import db from "../lib/db";
import {
  getExperiment,
  getExperimentRuns,
  getExperimentArtifacts,
  API_URL,
  type Experiment,
  type Run,
  type Artifact,
} from "../api";
import ReactMarkdown from "react-markdown";

interface GraphNode {
  id: string; label: string; type: "experiment" | "run" | "doc";
  slug?: string; group?: string; color: string; val: number;
}
interface GraphLink { source: string; target: string; color: string; }

const NODE_COLORS: Record<string, string> = { experiment: "#3b82f6", run: "#8b5cf6", doc: "#10b981" };
const GROUP_COLORS = ["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#84cc16","#f97316","#6366f1","#14b8a6","#a855f7","#f43f5e","#0ea5e9","#d946ef"];

function parseTags(s: string): string[] { try { return JSON.parse(s); } catch { return []; } }
function timeAgo(iso: string): string { const ms = Date.now() - new Date(iso).getTime(); const m = Math.floor(ms/60000); if (m<60) return `${m}m ago`; const h = Math.floor(m/60); if (h<24) return `${h}h ago`; return `${Math.floor(h/24)}d ago`; }
function parseHparams(json: string | null): Record<string, any> | null { if (!json) return null; try { return JSON.parse(json); } catch { return null; } }

function artifactPreviewUrl(art: Artifact): string | null {
  if (art.artifact_type === "plotly_json") return `${API_URL}/data/r2/${art.uri.replace(".json", ".html")}`;
  if (art.artifact_type === "plot_html") return `${API_URL}/data/r2/${art.uri}`;
  if (art.artifact_type === "png" || art.artifact_type === "image") return `${API_URL}/data/r2/${art.uri}`;
  return null;
}

// ── Artifact Preview ────────────────────────────────────────

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const url = artifactPreviewUrl(artifact);
  if (!url) return <div style={{ color: "#9ca3af", fontSize: "0.7rem", fontFamily: "monospace" }}>{artifact.uri.split("/").pop()}</div>;

  if (artifact.artifact_type === "png" || artifact.artifact_type === "image") {
    return <img src={url} alt={artifact.label || ""} style={{ width: "100%", height: "auto", borderRadius: 4, border: "1px solid #e5e7eb", objectFit: "contain" }} loading="lazy" />;
  }

  return (
    <div style={{ position: "relative", width: "100%", paddingBottom: "62%", borderRadius: 4, border: "1px solid #e5e7eb", overflow: "hidden" }}>
      <iframe src={url} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} loading="lazy" />
    </div>
  );
}

// ── Node Panel ──────────────────────────────────────────────

function NodePanel({ node, onClose, onFullscreen }: {
  node: GraphNode; onClose: () => void; onFullscreen: () => void;
}) {
  const [exp, setExp] = useState<Experiment | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [showArtifacts, setShowArtifacts] = useState(false);

  useEffect(() => {
    if (node.type !== "experiment" || !node.slug) { setLoading(false); return; }
    setLoading(true); setExpandedRun(null); setShowArtifacts(false);
    Promise.all([
      getExperiment(node.slug).catch(() => null),
      getExperimentRuns(node.slug).catch(() => ({ runs: [] })),
      getExperimentArtifacts(node.slug).catch(() => ({ artifacts: [] })),
    ]).then(([e, r, a]) => { setExp(e); setRuns(r.runs); setArtifacts(a.artifacts); setLoading(false); });
  }, [node.slug, node.type]);

  const artifactsByLabel = useMemo(() => {
    const m = new Map<string, Artifact[]>();
    artifacts.forEach(a => { const k = a.label || a.artifact_type; m.set(k, [...(m.get(k) || []), a]); });
    return [...m.entries()];
  }, [artifacts]);

  const previewableArtifacts = useMemo(() =>
    artifacts.filter(a => artifactPreviewUrl(a) !== null), [artifacts]);

  return (
    <div style={{ width: 450, borderLeft: "1px solid #e5e7eb", background: "white", display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
                <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Status</td><td><span style={{ background: "#d1fae5", color: "#065f46", padding: "0.08rem 0.35rem", borderRadius: 3, fontSize: "0.68rem" }}>{exp.status}</span></td></tr>
                <tr><td style={{ color: "#6b7280", padding: "0.12rem 0.3rem 0.12rem 0" }}>Created</td><td style={{ color: "#374151" }}>{timeAgo(exp.created_at)} by {exp.created_by}</td></tr>
              </tbody>
            </table>

            {exp.tags && parseTags(exp.tags).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                {parseTags(exp.tags).map(t => <span key={t} style={{ background: "#eff6ff", color: "#2563eb", fontSize: "0.65rem", padding: "0.08rem 0.35rem", borderRadius: 9999 }}>{t}</span>)}
              </div>
            )}

            {exp.intent && <div style={{ color: "#374151", lineHeight: 1.4, borderLeft: "2px solid #e5e7eb", paddingLeft: "0.5rem" }}>{exp.intent}</div>}

            {exp.notes_markdown && (
              <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: "0.5rem" }}>
                <div style={{ color: "#6b7280", fontSize: "0.68rem", fontWeight: 600, marginBottom: "0.2rem" }}>Notes</div>
                <div style={{ color: "#374151", lineHeight: 1.4, fontSize: "0.75rem" }}><ReactMarkdown>{exp.notes_markdown.slice(0, 500)}</ReactMarkdown></div>
              </div>
            )}

            {/* Runs */}
            <div>
              <div style={{ color: "#6b7280", fontSize: "0.68rem", fontWeight: 600, marginBottom: "0.2rem" }}>Runs ({runs.length})</div>
              {runs.slice(0, 15).map(r => {
                const hparams = parseHparams(r.hparams_json);
                const isExpanded = expandedRun === r.run_index;
                return (
                  <div key={r.run_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <div onClick={() => setExpandedRun(isExpanded ? null : r.run_index)} style={{ padding: "0.25rem 0", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
                      <span style={{ fontSize: "0.6rem", color: "#9ca3af", width: "1.2em" }}>{isExpanded ? "▼" : "▶"}</span>
                      <span style={{ fontSize: "0.6rem", color: "#9ca3af" }}>#{r.run_index}</span>
                      <span style={{ color: "#374151", flex: 1 }}>{r.label || `Run ${r.run_index}`}</span>
                      <span style={{ fontSize: "0.6rem", padding: "0.04rem 0.25rem", borderRadius: 3, background: r.status === "finalized" ? "#d1fae5" : "#e5e7eb", color: r.status === "finalized" ? "#065f46" : "#374151" }}>{r.status}</span>
                    </div>
                    {isExpanded && hparams && (
                      <div style={{ paddingLeft: "1.5em", paddingBottom: "0.3rem" }}>
                        <table style={{ borderCollapse: "collapse", fontSize: "0.7rem", width: "100%" }}>
                          <tbody>
                            {Object.entries(hparams).slice(0, 12).map(([k, v]) => (
                              <tr key={k}><td style={{ color: "#6b7280", padding: "0.08rem 0.3rem 0.08rem 0", whiteSpace: "nowrap", fontFamily: "monospace" }}>{k}</td>
                                <td style={{ color: "#374151", fontFamily: "monospace", wordBreak: "break-all" }}>{typeof v === "object" ? JSON.stringify(v) : String(v)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Artifact previews */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" }}>
                <span style={{ color: "#6b7280", fontSize: "0.68rem", fontWeight: 600 }}>Artifacts ({artifacts.length})</span>
                {previewableArtifacts.length > 0 && (
                  <button onClick={() => setShowArtifacts(!showArtifacts)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 3, padding: "0.08rem 0.35rem", fontSize: "0.65rem", cursor: "pointer", color: "#374151" }}>
                    {showArtifacts ? "Hide previews" : `Show ${previewableArtifacts.length} previews`}
                  </button>
                )}
              </div>

              {!showArtifacts && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.2rem" }}>
                  {artifactsByLabel.slice(0, 12).map(([label, arts]) => (
                    <span key={label} style={{ background: "#fef3c7", color: "#92400e", fontSize: "0.65rem", padding: "0.08rem 0.35rem", borderRadius: 3 }}>
                      {label}{arts.length > 1 ? ` ×${arts.length}` : ""}
                    </span>
                  ))}
                  {artifactsByLabel.length > 12 && <span style={{ color: "#9ca3af", fontSize: "0.65rem" }}>+{artifactsByLabel.length - 12} more</span>}
                </div>
              )}

              {showArtifacts && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {previewableArtifacts.slice(0, 20).map((art, i) => (
                    <div key={art.artifact_id || i}>
                      <div style={{ fontSize: "0.68rem", color: "#6b7280", marginBottom: "0.15rem" }}>
                        {art.label || art.artifact_type}
                        <span style={{ color: "#d1d5db" }}> · {art.artifact_type}</span>
                      </div>
                      <ArtifactPreview artifact={art} />
                    </div>
                  ))}
                  {previewableArtifacts.length > 20 && <div style={{ color: "#9ca3af", fontSize: "0.68rem" }}>+{previewableArtifacts.length - 20} more</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Selection Panel ─────────────────────────────────────────

function ExpandableExperiment({ node }: { node: GraphNode }) {
  const [expanded, setExpanded] = useState(false);
  const [exp, setExp] = useState<Experiment | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPreviews, setShowPreviews] = useState(false);

  useEffect(() => {
    if (!expanded || !node.slug || exp) return;
    setLoading(true);
    Promise.all([
      getExperiment(node.slug).catch(() => null),
      getExperimentRuns(node.slug).catch(() => ({ runs: [] })),
      getExperimentArtifacts(node.slug).catch(() => ({ artifacts: [] })),
    ]).then(([e, r, a]) => { setExp(e); setRuns(r.runs); setArtifacts(a.artifacts); setLoading(false); });
  }, [expanded, node.slug]);

  const previewable = useMemo(() => artifacts.filter(a => artifactPreviewUrl(a) !== null), [artifacts]);

  return (
    <div style={{ borderBottom: "1px solid #e5e7eb", marginBottom: "0.25rem" }}>
      <div onClick={() => setExpanded(!expanded)} style={{ padding: "0.35rem 0", display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
        <span style={{ fontSize: "0.6rem", color: "#9ca3af", width: "1.2em" }}>{expanded ? "▼" : "▶"}</span>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: node.color, flexShrink: 0 }} />
        <span style={{ color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.78rem" }}>{node.label}</span>
        {node.group && <span style={{ fontSize: "0.6rem", color: "#9ca3af" }}>{node.group}</span>}
      </div>

      {expanded && (
        <div style={{ paddingLeft: "1.2rem", paddingBottom: "0.5rem", fontSize: "0.75rem" }}>
          {loading && <div style={{ color: "#6b7280" }}>Loading...</div>}
          {exp && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: "#9ca3af" }}>{exp.slug}</div>
              <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.7rem", color: "#6b7280" }}>
                <span>{runs.length} runs</span> · <span>{artifacts.length} artifacts</span> · <span>{exp.created_by}</span>
              </div>

              {exp.tags && parseTags(exp.tags).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.15rem" }}>
                  {parseTags(exp.tags).map(t => <span key={t} style={{ background: "#eff6ff", color: "#2563eb", fontSize: "0.6rem", padding: "0.06rem 0.3rem", borderRadius: 9999 }}>{t}</span>)}
                </div>
              )}

              {exp.intent && <div style={{ color: "#374151", fontSize: "0.72rem", lineHeight: 1.3, borderLeft: "2px solid #e5e7eb", paddingLeft: "0.4rem" }}>{exp.intent}</div>}

              {/* Runs summary */}
              {runs.length > 0 && (
                <div>
                  <div style={{ color: "#6b7280", fontSize: "0.65rem", fontWeight: 600, marginBottom: "0.15rem" }}>Runs</div>
                  {runs.slice(0, 5).map(r => {
                    const hp = parseHparams(r.hparams_json);
                    const keys = hp ? Object.entries(hp).slice(0, 4).map(([k, v]) => `${k}=${typeof v === "object" ? "..." : v}`).join(", ") : "";
                    return (
                      <div key={r.run_id} style={{ fontSize: "0.68rem", color: "#374151", padding: "0.1rem 0" }}>
                        <span style={{ color: "#9ca3af" }}>#{r.run_index}</span> {r.label || ""} {keys && <span style={{ color: "#9ca3af" }}>({keys})</span>}
                      </div>
                    );
                  })}
                  {runs.length > 5 && <div style={{ fontSize: "0.65rem", color: "#9ca3af" }}>+{runs.length - 5} more</div>}
                </div>
              )}

              {/* Artifact previews */}
              {previewable.length > 0 && (
                <div>
                  <button onClick={() => setShowPreviews(!showPreviews)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 3, padding: "0.08rem 0.35rem", fontSize: "0.62rem", cursor: "pointer", color: "#374151" }}>
                    {showPreviews ? "Hide previews" : `Show ${previewable.length} previews`}
                  </button>
                  {showPreviews && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.3rem" }}>
                      {previewable.slice(0, 10).map((art, i) => (
                        <div key={art.artifact_id || i}>
                          <div style={{ fontSize: "0.62rem", color: "#6b7280", marginBottom: "0.1rem" }}>{art.label || art.artifact_type}</div>
                          <ArtifactPreview artifact={art} />
                        </div>
                      ))}
                      {previewable.length > 10 && <div style={{ fontSize: "0.62rem", color: "#9ca3af" }}>+{previewable.length - 10} more</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SelectionPanel({ nodes, onClose }: { nodes: GraphNode[]; onClose: () => void }) {
  const exps = nodes.filter(n => n.type === "experiment");
  const groups = [...new Set(exps.map(e => e.group).filter(Boolean))];
  return (
    <div style={{ width: 450, borderLeft: "1px solid #e5e7eb", background: "white", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600, flex: 1 }}>Selected {nodes.length} nodes</span>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1rem", cursor: "pointer", color: "#9ca3af" }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem", fontSize: "0.78rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.72rem", color: "#6b7280", marginBottom: "0.5rem" }}>
          <span>{exps.length} experiments</span>
          {groups.length > 0 && <span>· {groups.length} groups</span>}
        </div>
        {exps.map(e => <ExpandableExperiment key={e.id} node={e} />)}
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────

export function GraphView() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedNodes, setSelectedNodes] = useState<GraphNode[]>([]);
  const [showRuns, setShowRuns] = useState(false);
  const [colorByGroup, setColorByGroup] = useState(true);

  // Shift+drag selection
  const shiftHeld = useRef(false);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const [selBox, setSelBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") shiftHeld.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shiftHeld.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  // Attach to canvas directly for shift+drag
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const canvas = container.querySelector("canvas");
    if (!canvas) return;

    const onDown = (e: MouseEvent) => {
      if (!shiftHeld.current) return;
      e.stopPropagation();
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      dragOrigin.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setSelBox(null);
    };
    const onMove = (e: MouseEvent) => {
      if (!dragOrigin.current) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const ox = dragOrigin.current.x, oy = dragOrigin.current.y;
      setSelBox({ x: Math.min(ox, cx), y: Math.min(oy, cy), w: Math.abs(cx - ox), h: Math.abs(cy - oy) });
    };
    const onUp = () => {
      if (!dragOrigin.current || !selBox || !graphRef.current) { dragOrigin.current = null; setSelBox(null); return; }
      const graph = graphRef.current;
      const { x, y, w, h } = selBox;
      const selected = graphData.nodes.filter((node: any) => {
        const coords = graph.graph2ScreenCoords(node.x, node.y);
        return coords.x >= x && coords.x <= x + w && coords.y >= y && coords.y <= y + h;
      });
      if (selected.length > 0) { setSelectedNode(null); setSelectedNodes(selected); }
      dragOrigin.current = null;
      setSelBox(null);
    };

    canvas.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { canvas.removeEventListener("mousedown", onDown, true); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = db.useQuery({ experiments: { runs: {} } } as any);
  const { data: docsData } = db.useQuery({ draftPosts: {} });
  const experiments = (data as any)?.experiments ?? [];
  const docs = docsData?.draftPosts ?? [];
  const hasPanel = selectedNode || selectedNodes.length > 0;

  useEffect(() => {
    const measure = () => { if (containerRef.current) setDimensions({ width: containerRef.current.clientWidth, height: window.innerHeight - 48 }); };
    measure(); window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure);
  }, []);

  const groups = useMemo(() => { const s = new Set<string>(); experiments.forEach((e: any) => { if (e.group) s.add(e.group); }); return [...s].sort(); }, [experiments]);
  const groupColor = useCallback((g: string) => { const i = groups.indexOf(g); return i >= 0 ? GROUP_COLORS[i % GROUP_COLORS.length] : NODE_COLORS.experiment; }, [groups]);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [], links: GraphLink[] = [];
    experiments.forEach((exp: any) => {
      const color = colorByGroup && exp.group ? groupColor(exp.group) : NODE_COLORS.experiment;
      nodes.push({ id: `exp:${exp.id}`, label: exp.title || exp.slug, type: "experiment", slug: exp.slug, group: exp.group, color, val: 6 });
      if (showRuns && exp.runs) exp.runs.forEach((run: any) => {
        const rid = `run:${run.id}`;
        nodes.push({ id: rid, label: run.label || `Run ${run.runIndex}`, type: "run", color: NODE_COLORS.run, val: 3 });
        links.push({ source: `exp:${exp.id}`, target: rid, color: "#c4b5fd" });
      });
    });
    if (colorByGroup) {
      const bg = new Map<string, string[]>();
      experiments.forEach((e: any) => { if (e.group) { const l = bg.get(e.group) || []; l.push(`exp:${e.id}`); bg.set(e.group, l); } });
      bg.forEach(ids => { for (let i = 1; i < ids.length; i++) links.push({ source: ids[0], target: ids[i], color: "#e5e7eb" }); });
    }
    docs.forEach((d: any) => nodes.push({ id: `doc:${d.id}`, label: d.title || d.slug, type: "doc", slug: d.slug, color: NODE_COLORS.doc, val: 5 }));
    return { nodes, links };
  }, [experiments, docs, showRuns, colorByGroup, groupColor]);

  const selectedIds = useMemo(() => new Set([...(selectedNode ? [selectedNode.id] : []), ...selectedNodes.map(n => n.id)]), [selectedNode, selectedNodes]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const size = node.val || 4;
    const isH = hoveredNode?.id === node.id, isS = selectedIds.has(node.id);
    ctx.beginPath(); ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
    ctx.fillStyle = node.color; ctx.globalAlpha = isH || isS ? 1 : 0.85; ctx.fill();
    if (isS) { ctx.strokeStyle = "#1d4ed8"; ctx.lineWidth = 3 / globalScale; ctx.stroke(); }
    else if (isH) { ctx.strokeStyle = node.color; ctx.lineWidth = 2 / globalScale; ctx.stroke(); }
    if (globalScale > 1.2 || isH || isS) {
      ctx.globalAlpha = isH || isS ? 1 : 0.6;
      ctx.font = `${isH || isS ? "bold " : ""}${Math.max(10 / globalScale, 1.5)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#374151";
      ctx.fillText(node.label.length > 35 ? node.label.slice(0, 33) + "…" : node.label, node.x, node.y + size + 2);
    }
    ctx.globalAlpha = 1;
  }, [hoveredNode, selectedIds]);

  const closePanel = useCallback(() => { setSelectedNode(null); setSelectedNodes([]); }, []);

  return (
    <div className="strata" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ borderBottom: "1px solid #e5e7eb", padding: "0.4rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem", background: "white", height: 48 }}>
        <Link to="/" style={{ color: "#6b7280", fontSize: "0.85rem" }}>← Feed</Link>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>Graph</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.7rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}><input type="checkbox" checked={showRuns} onChange={e => setShowRuns(e.target.checked)} /> Runs</label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}><input type="checkbox" checked={colorByGroup} onChange={e => setColorByGroup(e.target.checked)} /> Groups</label>
          <span style={{ color: "#d1d5db" }}>|</span>
          {Object.entries(NODE_COLORS).map(([t, c]) => <span key={t} style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: c, display: "inline-block" }} /> {t}</span>)}
          <span style={{ color: "#9ca3af" }}>{graphData.nodes.length} nodes</span>
          <span style={{ color: "#c4b5fd", fontSize: "0.62rem" }}>Shift+drag to select</span>
        </div>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div ref={containerRef} style={{ flex: 1, position: "relative" }}>
          {isLoading ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#6b7280" }}>Loading graph...</div> : (
            <ForceGraph2D
              ref={graphRef}
              graphData={graphData}
              width={hasPanel ? dimensions.width - 450 : dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => { ctx.beginPath(); ctx.arc(node.x, node.y, (node.val || 4) + 4, 0, 2 * Math.PI); ctx.fillStyle = color; ctx.fill(); }}
              onNodeClick={(node: any) => { setSelectedNodes([]); setSelectedNode(node); }}
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

          {selBox && <div style={{ position: "absolute", left: selBox.x, top: selBox.y, width: selBox.w, height: selBox.h, border: "2px dashed #3b82f6", background: "rgba(59,130,246,0.08)", pointerEvents: "none", zIndex: 5 }} />}

          {hoveredNode && !hasPanel && (
            <div style={{ position: "absolute", top: 8, right: 8, background: "white", border: "1px solid #e5e7eb", borderRadius: 6, padding: "0.5rem 0.75rem", fontSize: "0.75rem", maxWidth: 260, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight: 600, color: hoveredNode.color }}>{hoveredNode.type}</div>
              <div style={{ color: "#374151" }}>{hoveredNode.label}</div>
              {hoveredNode.group && <div style={{ color: "#9ca3af", fontSize: "0.65rem" }}>{hoveredNode.group}</div>}
            </div>
          )}
        </div>

        {selectedNode && <NodePanel node={selectedNode} onClose={closePanel} onFullscreen={() => { if (selectedNode.slug) navigate(selectedNode.type === "doc" ? `/doc/${selectedNode.slug}` : `/e/${selectedNode.slug}`); }} />}
        {selectedNodes.length > 0 && !selectedNode && <SelectionPanel nodes={selectedNodes} onClose={closePanel} />}
      </div>
    </div>
  );
}
