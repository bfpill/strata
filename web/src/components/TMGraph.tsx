import { useMemo, useState, useCallback, useRef } from "react";

interface Model {
  alphabet: string[];
  states: string[];
  dirs: string[];
  transition_pairs: [string, string][];
}

interface Code {
  writes: number[];
  states: number[];
  moves: number[];
}

interface TMGraphProps {
  model: Model;
  code: Code;
  used?: boolean[] | number[];
  width?: number;
  height?: number;
}

interface NodePos {
  x: number;
  y: number;
}

interface MergedEdge {
  src: number;
  dst: number;
  labels: string[];
  anyUnused: boolean;
}

/** Circular node layout. */
function circularLayout(
  n: number,
  width: number,
  height: number,
  padding: number,
): NodePos[] {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(cx, cy) - padding;
  if (n === 1) return [{ x: cx, y: cy }];
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI + (2 * Math.PI * i) / n;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}

function buildEdgeLabel(
  readSym: string,
  writeSym: string,
  moveDir: string,
  showWrite: boolean,
  showMove: boolean,
): string {
  let label = readSym;
  if (showWrite) label += `/${writeSym}`;
  if (showMove) label += ` ${moveDir}`;
  return label;
}

function buildEdges(
  model: Model,
  code: Code,
  showWrite: boolean,
  showMove: boolean,
  used?: boolean[] | number[],
): MergedEdge[] {
  const edgeMap = new Map<string, MergedEdge>();
  for (let d = 0; d < model.transition_pairs.length; d++) {
    const [readSym, srcState] = model.transition_pairs[d];
    const srcIdx = model.states.indexOf(srcState);
    const dstIdx = code.states[d];
    const writeSym = model.alphabet[code.writes[d]];
    const moveDir = model.dirs[code.moves[d]];
    const isUsed = used ? Boolean(used[d]) : true;
    const label = buildEdgeLabel(readSym, writeSym, moveDir, showWrite, showMove);
    const key = `${srcIdx}->${dstIdx}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.labels.push(label);
      if (!isUsed) existing.anyUnused = true;
    } else {
      edgeMap.set(key, { src: srcIdx, dst: dstIdx, labels: [label], anyUnused: !isUsed });
    }
  }
  return Array.from(edgeMap.values());
}

function edgePath(src: NodePos, dst: NodePos, nodeRadius: number, curveOffset: number): string {
  const dx = dst.x - src.x;
  const dy = dst.y - src.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return "";
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;
  const sx = src.x + ux * nodeRadius, sy = src.y + uy * nodeRadius;
  const ex = dst.x - ux * nodeRadius, ey = dst.y - uy * nodeRadius;
  const mx = (sx + ex) / 2 + nx * curveOffset;
  const my = (sy + ey) / 2 + ny * curveOffset;
  return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
}

function selfLoopPath(node: NodePos, nodeRadius: number, loopAngle: number, loopSize: number): string {
  const spreadAngle = 0.4;
  const sx = node.x + nodeRadius * Math.cos(loopAngle - spreadAngle);
  const sy = node.y + nodeRadius * Math.sin(loopAngle - spreadAngle);
  const ex = node.x + nodeRadius * Math.cos(loopAngle + spreadAngle);
  const ey = node.y + nodeRadius * Math.sin(loopAngle + spreadAngle);
  const cx1 = node.x + (nodeRadius + loopSize) * Math.cos(loopAngle - 0.5);
  const cy1 = node.y + (nodeRadius + loopSize) * Math.sin(loopAngle - 0.5);
  const cx2 = node.x + (nodeRadius + loopSize) * Math.cos(loopAngle + 0.5);
  const cy2 = node.y + (nodeRadius + loopSize) * Math.sin(loopAngle + 0.5);
  return `M ${sx} ${sy} C ${cx1} ${cy1} ${cx2} ${cy2} ${ex} ${ey}`;
}

function edgeLabelPos(src: NodePos, dst: NodePos, curveOffset: number): { x: number; y: number } {
  const mx = (src.x + dst.x) / 2, my = (src.y + dst.y) / 2;
  const dx = dst.x - src.x, dy = dst.y - src.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / dist, ny = dx / dist;
  const labelOffset = curveOffset * 0.5 + Math.sign(curveOffset || 1) * 12;
  return { x: mx + nx * labelOffset, y: my + ny * labelOffset };
}

function selfLoopLabelPos(node: NodePos, nodeRadius: number, loopAngle: number, loopSize: number): { x: number; y: number } {
  return {
    x: node.x + (nodeRadius + loopSize + 10) * Math.cos(loopAngle),
    y: node.y + (nodeRadius + loopSize + 10) * Math.sin(loopAngle),
  };
}

export function TMGraph({ model, code, used, width = 500, height = 400 }: TMGraphProps) {
  const [showWrite, setShowWrite] = useState(false);
  const [showMove, setShowMove] = useState(false);

  const nodeRadius = 22;
  const padding = 70;

  // Initialize positions from circular layout; stored in state for dragging
  const initialPositions = useMemo(
    () => circularLayout(model.states.length, width, height, padding),
    [model.states.length, width, height],
  );
  const [positions, setPositions] = useState<NodePos[]>(initialPositions);

  // Reset layout when model changes
  const prevStatesRef = useRef(model.states);
  if (model.states !== prevStatesRef.current) {
    prevStatesRef.current = model.states;
    setPositions(circularLayout(model.states.length, width, height, padding));
  }

  // Drag state
  const dragRef = useRef<{ nodeIdx: number; offsetX: number; offsetY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getSVGPoint = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeIdx: number) => {
    e.preventDefault();
    const pt = getSVGPoint(e);
    dragRef.current = {
      nodeIdx,
      offsetX: pt.x - positions[nodeIdx].x,
      offsetY: pt.y - positions[nodeIdx].y,
    };
  }, [positions, getSVGPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const pt = getSVGPoint(e);
    const { nodeIdx, offsetX, offsetY } = dragRef.current;
    setPositions((prev) => {
      const next = [...prev];
      next[nodeIdx] = { x: pt.x - offsetX, y: pt.y - offsetY };
      return next;
    });
  }, [getSVGPoint]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const edges = useMemo(
    () => buildEdges(model, code, showWrite, showMove, used),
    [model, code, showWrite, showMove, used],
  );

  const edgeOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    const edgeSet = new Set(edges.map((e) => `${e.src}->${e.dst}`));
    for (const e of edges) {
      const key = `${e.src}->${e.dst}`;
      const reverseKey = `${e.dst}->${e.src}`;
      if (e.src === e.dst) {
        offsets.set(key, 0);
      } else if (edgeSet.has(reverseKey)) {
        offsets.set(key, 25);
      } else {
        offsets.set(key, 0);
      }
    }
    return offsets;
  }, [edges]);

  // Self-loop angles: point away from centroid of other nodes
  const selfLoopAngles = useMemo(() => {
    const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
    return positions.map((p) => Math.atan2(p.y - cy, p.x - cx));
  }, [positions]);

  const markerId = "tm-graph-arrow";

  return (
    <div className="tm-graph-container">
      <div className="tm-graph-controls">
        <label>
          <input type="checkbox" checked={showWrite} onChange={(e) => setShowWrite(e.target.checked)} />
          {" "}write
        </label>
        <label>
          <input type="checkbox" checked={showMove} onChange={(e) => setShowMove(e.target.checked)} />
          {" "}move
        </label>
      </div>

      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="tm-graph-svg"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 6"
            refX="9" refY="3"
            markerWidth="8" markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 3 L 0 6 z" fill="#555" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((e) => {
          const key = `${e.src}->${e.dst}`;
          const isSelfLoop = e.src === e.dst;
          const offset = edgeOffsets.get(key) ?? 0;
          const label = e.labels.join(", ");
          const edgeColor = e.anyUnused ? "#ccc" : "#555";
          const labelColor = e.anyUnused ? "#aaa" : "#333";

          if (isSelfLoop) {
            const angle = selfLoopAngles[e.src];
            const d = selfLoopPath(positions[e.src], nodeRadius, angle, 35);
            const lp = selfLoopLabelPos(positions[e.src], nodeRadius, angle, 35);
            return (
              <g key={key}>
                <path d={d} fill="none" stroke={edgeColor} strokeWidth={1.5} markerEnd={`url(#${markerId})`} />
                <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill={labelColor}>{label}</text>
              </g>
            );
          }

          const d = edgePath(positions[e.src], positions[e.dst], nodeRadius, offset);
          const lp = edgeLabelPos(positions[e.src], positions[e.dst], offset);
          return (
            <g key={key}>
              <path d={d} fill="none" stroke={edgeColor} strokeWidth={1.5} markerEnd={`url(#${markerId})`} />
              <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill={labelColor}>{label}</text>
            </g>
          );
        })}

        {/* Nodes */}
        {positions.map((pos, i) => (
          <g
            key={i}
            style={{ cursor: "grab" }}
            onMouseDown={(e) => handleNodeMouseDown(e, i)}
          >
            <circle cx={pos.x} cy={pos.y} r={nodeRadius} fill="white" stroke="#333" strokeWidth={2} />
            <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight="bold" fill="#333">
              {model.states[i]}
            </text>
          </g>
        ))}

        {/* Entry arrow to initial state */}
        {positions.length > 0 && (
          <line
            x1={positions[0].x - nodeRadius - 25} y1={positions[0].y}
            x2={positions[0].x - nodeRadius - 2} y2={positions[0].y}
            stroke="#333" strokeWidth={2} markerEnd={`url(#${markerId})`}
          />
        )}
      </svg>
    </div>
  );
}
