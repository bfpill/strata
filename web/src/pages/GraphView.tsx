import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import db from "../lib/db";

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

export function GraphView() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
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
          nodes.push({
            id: runId,
            label: run.label || `Run ${run.runIndex}`,
            type: "run",
            color: NODE_COLORS.run,
            val: 3,
          });
          links.push({
            source: `exp:${exp.id}`,
            target: runId,
            color: "#c4b5fd",
          });
        });
      }
    });

    // Group clustering: link experiments in the same group
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

    // Doc nodes
    docs.forEach((doc: any) => {
      nodes.push({
        id: `doc:${doc.id}`,
        label: doc.title || doc.slug,
        type: "doc",
        slug: doc.slug,
        color: NODE_COLORS.doc,
        val: 5,
      });
    });

    return { nodes, links };
  }, [experiments, docs, showRuns, colorByGroup, groupColor]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.type === "experiment" && node.slug) navigate(`/e/${node.slug}`);
      else if (node.type === "doc" && node.slug) navigate(`/doc/${node.slug}`);
    },
    [navigate]
  );

  const paintNode = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const size = node.val || 4;
      const isHovered = hoveredNode?.id === node.id;
      const fontSize = Math.max(10 / globalScale, 1.5);

      ctx.beginPath();
      ctx.arc(node.x, node.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.globalAlpha = isHovered ? 1 : 0.85;
      ctx.fill();

      if (isHovered) {
        ctx.strokeStyle = node.color;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      if (globalScale > 1.2 || isHovered) {
        ctx.globalAlpha = isHovered ? 1 : 0.6;
        ctx.font = `${isHovered ? "bold " : ""}${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#374151";
        const label = node.label.length > 35 ? node.label.slice(0, 33) + "…" : node.label;
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
        <div style={{ marginLeft: "auto", display: "flex", gap: "1rem", alignItems: "center", fontSize: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
            <input type="checkbox" checked={showRuns} onChange={e => setShowRuns(e.target.checked)} />
            Show runs
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", cursor: "pointer" }}>
            <input type="checkbox" checked={colorByGroup} onChange={e => setColorByGroup(e.target.checked)} />
            Color by group
          </label>
          <span style={{ color: "#d1d5db" }}>|</span>
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
            linkColor={(link: any) => link.color || "#e5e7eb"}
            linkWidth={0.8}
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            backgroundColor="#fafafa"
          />
        )}

        {hoveredNode && (
          <div style={{
            position: "absolute", top: 12, right: 12, background: "white", border: "1px solid #e5e7eb",
            borderRadius: 8, padding: "0.75rem 1rem", fontSize: "0.8rem", maxWidth: 300, boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: hoveredNode.color }}>{hoveredNode.type}</div>
            <div style={{ color: "#374151" }}>{hoveredNode.label}</div>
            {hoveredNode.slug && <div style={{ color: "#9ca3af", fontSize: "0.7rem", fontFamily: "monospace", marginTop: "0.15rem" }}>{hoveredNode.slug}</div>}
            {hoveredNode.group && <div style={{ color: "#6b7280", fontSize: "0.7rem", marginTop: "0.15rem" }}>Group: {hoveredNode.group}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
