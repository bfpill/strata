import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { FetchStore, open, get, root } from "zarrita";
import createScatterplot from "regl-scatterplot";
import Plot from "../plotly";
import { SimulatorPane } from "./SimulatorPane";
import { TM_SPACE_PANEL_REGISTRY } from "./tmSpacePanels";
import "./TmSpacePane.css";

const openV3 = open.v3;

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://strata.timaeus-research-inc.workers.dev";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Model {
  alphabet: string[];
  states: string[];
  dirs: string[];
  transition_pairs: [string, string][];
  skip_staging?: boolean;
}

interface Task {
  inputs: string[];
  outputs: string[];
  dist: number[];
  tm_steps: number;
}

interface ColorArraySpec {
  name: string;
  label: string;
  type: "continuous" | "categorical";
}

interface DetailPanelSpec {
  label: string;
  // Legacy: figure template + single zarr array URI; the slice patches into
  // the first trace's z (heatmap) or x/y (scatter).
  figure?: { data: any[]; layout: any };
  zarr_uri?: string;
  // Custom: name of a registered component in TM_SPACE_PANEL_REGISTRY. The
  // component does its own data loading and is responsible for rendering.
  component?: string;
  zarr_group?: string;
  params?: Record<string, unknown>;
}

interface PointLabel {
  tm: number;
  label: string;
}

export interface TmSpaceData {
  scatter: {
    zarr_uri: string;
    xy_array: string;
    color_arrays: ColorArraySpec[];
    tm_coord: string;
    labels?: PointLabel[];
  };
  code_browser?: {
    model: Model;
    task: Task;
    zarr_uri: string;
  };
  detail_panels?: DetailPanelSpec[];
}

export interface TmSpacePaneProps {
  data: TmSpaceData;
  headerControls?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Zarr helpers
// ---------------------------------------------------------------------------

function zarrStore() {
  return new FetchStore(`${API_URL}/data/r2/`);
}

async function loadArray(uri: string): Promise<any> {
  const store = zarrStore();
  const loc = root(store).resolve(uri);
  return openV3(loc, { kind: "array" });
}

async function loadSlice(zarrArr: any, index: number): Promise<any> {
  // Read arr[index, ...] — works for 2D and 3D arrays
  const ndim = zarrArr.shape.length;
  if (ndim === 2) {
    const result = await get(zarrArr, [index, null]);
    return result;
  } else if (ndim === 3) {
    const result = await get(zarrArr, [index, null, null]);
    return result;
  }
  return await get(zarrArr, [index]);
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

// Viridis-like palette (16 stops)
const VIRIDIS = [
  [68, 1, 84], [72, 26, 108], [71, 47, 126], [65, 68, 135],
  [57, 86, 140], [49, 104, 142], [42, 120, 142], [35, 137, 141],
  [31, 154, 138], [34, 170, 131], [56, 186, 118], [94, 201, 98],
  [143, 215, 68], [196, 225, 44], [243, 229, 30], [253, 231, 37],
];

function viridisColor(t: number): [number, number, number, number] {
  const idx = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, VIRIDIS.length - 1);
  const f = idx - lo;
  return [
    Math.round(VIRIDIS[lo][0] * (1 - f) + VIRIDIS[hi][0] * f),
    Math.round(VIRIDIS[lo][1] * (1 - f) + VIRIDIS[hi][1] * f),
    Math.round(VIRIDIS[lo][2] * (1 - f) + VIRIDIS[hi][2] * f),
    255,
  ];
}

// 10-color categorical palette
const CATEGORICAL_COLORS: [number, number, number, number][] = [
  [31, 119, 180, 255], [255, 127, 14, 255], [44, 160, 44, 255],
  [214, 39, 40, 255], [148, 103, 189, 255], [140, 86, 75, 255],
  [227, 119, 194, 255], [127, 127, 127, 255], [188, 189, 34, 255],
  [23, 190, 207, 255],
];

// ---------------------------------------------------------------------------
// Color legend component
// ---------------------------------------------------------------------------

function ColorLegend({
  values, spec, colorRange, onColorRangeChange, hiddenCategories, onHiddenCategoriesChange,
}: {
  values: Float32Array | Int32Array | null;
  spec: ColorArraySpec;
  colorRange: [number, number] | null;
  onColorRangeChange: (range: [number, number] | null) => void;
  hiddenCategories: Set<number>;
  onHiddenCategoriesChange: (hidden: Set<number>) => void;
}) {
  if (!values) return null;

  if (spec.type === "categorical") {
    const unique = [...new Set(Array.from(values))].sort((a, b) => a - b);
    return (
      <div className="tm-space-legend tm-space-legend-categorical">
        {unique.map((v, i) => {
          const c = CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length];
          const hidden = hiddenCategories.has(v);
          return (
            <span
              key={v}
              className={`tm-space-legend-item ${hidden ? "tm-space-legend-item-hidden" : ""}`}
              onClick={() => {
                const next = new Set(hiddenCategories);
                if (hidden) next.delete(v); else next.add(v);
                onHiddenCategoriesChange(next);
              }}
            >
              <span
                className="tm-space-legend-swatch"
                style={{
                  backgroundColor: hidden ? "transparent" : `rgb(${c[0]},${c[1]},${c[2]})`,
                  borderColor: `rgb(${c[0]},${c[1]},${c[2]})`,
                }}
              />
              {v}
            </span>
          );
        })}
      </div>
    );
  }

  // Continuous: gradient bar with dual range handles
  let dataMin = Infinity, dataMax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < dataMin) dataMin = values[i];
    if (values[i] > dataMax) dataMax = values[i];
  }
  const stops = Array.from({ length: 16 }, (_, i) => {
    const c = viridisColor(i / 15);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }).join(", ");

  const lo = colorRange ? colorRange[0] : dataMin;
  const hi = colorRange ? colorRange[1] : dataMax;
  const step = (dataMax - dataMin) / 200 || 0.001;

  return (
    <div className="tm-space-legend tm-space-legend-continuous">
      <span className="tm-space-legend-label">{lo.toFixed(3)}</span>
      <div
        className="tm-space-range-track"
        onMouseDown={(e) => {
          // Middle-drag: shift both handles together
          const track = e.currentTarget;
          const rect = track.getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          const val = dataMin + frac * (dataMax - dataMin);
          // Only middle-drag if click is well between the two handles (not near thumbs)
          const thumbZone = (dataMax - dataMin) * 0.03;
          if (val > lo + thumbZone && val < hi - thumbZone) {
            e.preventDefault();
            const startX = e.clientX;
            const startLo = lo;
            const startHi = hi;
            const span = hi - lo;
            const range = dataMax - dataMin;
            const onMove = (ev: MouseEvent) => {
              const dx = ev.clientX - startX;
              const dVal = (dx / rect.width) * range;
              let newLo = startLo + dVal;
              let newHi = startHi + dVal;
              if (newLo < dataMin) { newLo = dataMin; newHi = dataMin + span; }
              if (newHi > dataMax) { newHi = dataMax; newLo = dataMax - span; }
              onColorRangeChange([newLo, newHi]);
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              document.body.style.cursor = "";
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
            document.body.style.cursor = "grabbing";
          }
        }}
      >
        <div className="tm-space-legend-gradient" style={{ background: `linear-gradient(to right, ${stops})` }} />
        <input
          className="tm-space-range-input tm-space-range-lo"
          type="range"
          min={dataMin}
          max={dataMax}
          step={step}
          value={lo}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onColorRangeChange([Math.min(v, hi), hi]);
          }}
        />
        <input
          className="tm-space-range-input tm-space-range-hi"
          type="range"
          min={dataMin}
          max={dataMax}
          step={step}
          value={hi}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onColorRangeChange([lo, Math.max(v, lo)]);
          }}
        />
      </div>
      <span className="tm-space-legend-label">{hi.toFixed(3)}</span>
      {colorRange && (
        <button className="tm-space-range-reset" onClick={() => onColorRangeChange(null)} title="Reset range">×</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel component
// ---------------------------------------------------------------------------

/** Legacy figure-template detail panel: takes a Plotly template + a single
 *  zarr array URI, slices arr[tmIndex, ...] and patches it into the first
 *  trace's z (heatmap) or x/y (scatter). For more complex per-TM panels see
 *  the registered components in tmSpacePanels/. */
interface LegacyPanelSpec { label: string; figure: { data: any[]; layout: any }; zarr_uri: string; }

function DetailPanel({
  panel,
  tmIndex,
}: {
  panel: LegacyPanelSpec;
  tmIndex: number;
}) {
  const [zarrArr, setZarrArr] = useState<any>(null);
  const [figure, setFigure] = useState<{ data: any[]; layout: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Open zarr array on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadArray(panel.zarr_uri)
      .then((arr) => { if (!cancelled) setZarrArr(arr); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [panel.zarr_uri]);

  // Load slice when tmIndex or zarrArr changes
  useEffect(() => {
    if (!zarrArr) return;
    let cancelled = false;
    loadSlice(zarrArr, tmIndex)
      .then((slice) => {
        if (cancelled) return;
        // Deep clone the template figure and patch in data
        const fig = JSON.parse(JSON.stringify(panel.figure));
        const trace = fig.data[0];
        if (!trace) return;

        if (trace.type === "heatmap") {
          // slice is 2D: [rows, cols]
          const rows = zarrArr.shape[1];
          const cols = zarrArr.shape[2];
          const z: number[][] = [];
          for (let r = 0; r < rows; r++) {
            const row: number[] = [];
            for (let c = 0; c < cols; c++) {
              row.push(slice.data[r * cols + c]);
            }
            z.push(row);
          }
          trace.z = z;
        } else if (trace.type === "scatter" || trace.type === "scattergl") {
          // slice is 2D: [N, 2]
          const n = zarrArr.shape[1];
          const x: number[] = [];
          const y: number[] = [];
          for (let i = 0; i < n; i++) {
            x.push(slice.data[i * 2]);
            y.push(slice.data[i * 2 + 1]);
          }
          trace.x = x;
          trace.y = y;
        }

        setFigure(fig);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [zarrArr, tmIndex, panel.figure]);

  if (loading) return <div className="tm-space-detail-loading">Loading...</div>;
  if (error) return <div className="tm-space-detail-error">Error: {error}</div>;
  if (!figure) return <div className="tm-space-detail-loading">No data</div>;

  return (
    <Plot
      data={figure.data}
      layout={{
        ...figure.layout,
        autosize: true,
        margin: { l: 50, r: 20, t: 40, b: 50 },
      }}
      config={{ responsive: true, displayModeBar: false }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Code browser in drawer
// ---------------------------------------------------------------------------

interface Code {
  writes: number[];
  states: number[];
  moves: number[];
}

function DrawerCodeBrowser({
  config,
  tmIndex,
  tmCoord,
}: {
  config: { model: Model; task: Task; zarr_uri: string };
  tmIndex: number;
  tmCoord: number;
}) {
  const [code, setCode] = useState<Code | null>(null);
  const [zarrArrays, setZarrArrays] = useState<{ writes: any; states: any; moves: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const codeCache = useRef(new Map<number, Code>());

  // Open zarr arrays
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const store = zarrStore();
    const loc = root(store).resolve(config.zarr_uri);
    Promise.all([
      openV3(loc, { kind: "group" }).then(async (grp) => ({
        writes: await openV3(grp.resolve("writes"), { kind: "array" }),
        states: await openV3(grp.resolve("states"), { kind: "array" }),
        moves: await openV3(grp.resolve("moves"), { kind: "array" }),
      })),
    ])
      .then(([arrays]) => { if (!cancelled) setZarrArrays(arrays); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [config.zarr_uri]);

  // Load code for current TM
  useEffect(() => {
    if (!zarrArrays) return;
    const cached = codeCache.current.get(tmIndex);
    if (cached) { setCode(cached); return; }
    let cancelled = false;
    Promise.all([
      get(zarrArrays.writes, [tmIndex, null]),
      get(zarrArrays.states, [tmIndex, null]),
      get(zarrArrays.moves, [tmIndex, null]),
    ]).then(([w, s, m]) => {
      if (cancelled) return;
      const c: Code = {
        writes: Array.from(w.data as Iterable<number>),
        states: Array.from(s.data as Iterable<number>),
        moves: Array.from(m.data as Iterable<number>),
      };
      codeCache.current.set(tmIndex, c);
      setCode(c);
    });
    return () => { cancelled = true; };
  }, [zarrArrays, tmIndex]);

  if (loading || !code) return <div className="tm-space-detail-loading">Loading code...</div>;

  const codeLabel = `tm ${tmCoord}`;
  return (
    <SimulatorPane
      model={config.model}
      task={config.task}
      codes={{ [codeLabel]: code }}
      hideCodeSelector
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TmSpacePane({ data, headerControls }: TmSpacePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scatterplotRef = useRef<any>(null);
  const drawPromiseRef = useRef<Promise<void>>(Promise.resolve());

  // Scatter data
  const [xy, setXy] = useState<Float32Array | null>(null);
  const [numPoints, setNumPoints] = useState(0);
  const [tmCoords, setTmCoords] = useState<Int32Array | Float32Array | null>(null);
  const [colorArrays, setColorArrays] = useState<Map<string, Float32Array | Int32Array>>(new Map());

  // UI state
  const [activeColor, setActiveColor] = useState<string>(data.scatter.color_arrays[0]?.name ?? "");
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerUserClosed, setDrawerUserClosed] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState(480);
  const [activeTab, setActiveTab] = useState<string>("code");
  const [pointSize, setPointSize] = useState(20);
  const [colorRange, setColorRange] = useState<[number, number] | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<Set<number>>(new Set());
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Drawer resize via drag handle
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startX - ev.clientX;
      setDrawerWidth(Math.max(240, startWidth + delta));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Nudge components that rely on window resize for layout
      window.dispatchEvent(new Event("resize"));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [drawerWidth]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Derived: which point to show in drawer
  const focusedPoint = hoveredPoint ?? selectedPoint;
  const focusedTmCoord = focusedPoint != null && tmCoords ? tmCoords[focusedPoint] : null;

  // TM coord → index lookup
  const tmToIndex = useMemo(() => {
    if (!tmCoords) return null;
    const map = new Map<number, number>();
    for (let i = 0; i < tmCoords.length; i++) map.set(tmCoords[i], i);
    return map;
  }, [tmCoords]);

  const [searchInput, setSearchInput] = useState("");

  const handleSearch = useCallback(() => {
    const val = parseInt(searchInput);
    if (isNaN(val) || !tmToIndex) return;
    const idx = tmToIndex.get(val);
    if (idx == null) return;
    setSelectedPoint(idx);
    setDrawerOpen(true);
    setDrawerUserClosed(false);
    // Select + zoom to it
    const sp = scatterplotRef.current;
    if (sp) {
      sp.select([idx]);
      sp.zoomToPoints([idx], { padding: 0.5, transition: true, transitionDuration: 300 });
    }
  }, [searchInput, tmToIndex]);

  // Build tab list
  const tabs = useMemo(() => {
    const t: { id: string; label: string }[] = [];
    if (data.code_browser) t.push({ id: "code", label: "Code" });
    for (const panel of data.detail_panels ?? []) {
      t.push({ id: `panel_${panel.label}`, label: panel.label });
    }
    return t;
  }, [data.code_browser, data.detail_panels]);

  // ---------- Load scatter data ----------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const { scatter } = data;
    const store = zarrStore();
    const loc = root(store).resolve(scatter.zarr_uri);

    (async () => {
      const grp = await openV3(loc, { kind: "group" });

      // Load XY coordinates
      const xyArr = await openV3(grp.resolve(scatter.xy_array), { kind: "array" });
      const xyData = await get(xyArr, null);
      const n = xyArr.shape[0];

      // Load TM coordinates (may be BigInt64Array from int64 zarr — convert to Int32)
      let tmData: Int32Array | Float32Array | null = null;
      try {
        const tmArr = await openV3(grp.resolve(scatter.tm_coord), { kind: "array" });
        const tmRaw = await get(tmArr, null);
        const raw = tmRaw.data;
        if (raw instanceof BigInt64Array) {
          tmData = Int32Array.from(raw, (v) => Number(v));
        } else {
          tmData = raw as any;
        }
      } catch {
        // No tm coord — use indices
      }

      // Load color arrays
      const colors = new Map<string, Float32Array | Int32Array>();
      for (const spec of scatter.color_arrays) {
        try {
          const arr = await openV3(grp.resolve(spec.name), { kind: "array" });
          const raw = await get(arr, null);
          colors.set(spec.name, raw.data as any);
        } catch {
          // Color array not available
        }
      }

      if (!cancelled) {
        setXy(xyData.data as Float32Array);
        setNumPoints(n);
        setTmCoords(tmData);
        setColorArrays(colors);
        setLoading(false);
      }
    })().catch((e) => {
      if (!cancelled) { setError(String(e)); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [data.scatter.zarr_uri]);

  // ---------- Initialize scatterplot ----------

  useEffect(() => {
    if (!xy || !canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    const n = numPoints;

    // Build point positions as object format
    const xArr = new Float32Array(n);
    const yArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xArr[i] = xy[i * 2];
      yArr[i] = xy[i * 2 + 1];
    }

    const scatterplot = createScatterplot({
      canvas: canvasRef.current,
      width: w,
      height: h,
      pointSize: 20,
      opacity: 0.8,
      showReticle: true,
      reticleColor: [1, 1, 1, 0.5],
      deselectOnDblClick: true,
      deselectOnEscape: true,
      lassoOnLongPress: true,
    });

    scatterplotRef.current = scatterplot;

    // Resize on container size change
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        scatterplot.set({ width: Math.round(width), height: Math.round(height) });
      }
    });
    ro.observe(container);

    // Draw points, then zoom to fit all points
    const allIdx = Array.from({ length: n }, (_, i) => i);
    drawPromiseRef.current = scatterplot.draw({ x: xArr, y: yArr }).then(() => {
      return scatterplot.zoomToPoints(allIdx, { padding: 0.1, transition: false });
    });

    // Events
    scatterplot.subscribe("pointOver", (idx: number) => {
      setHoveredPoint(idx);
    });
    scatterplot.subscribe("pointOut", () => {
      setHoveredPoint(null);
    });
    scatterplot.subscribe("select", ({ points }: { points: number[] }) => {
      if (points.length > 0) {
        setSelectedPoint(points[0]);
        setDrawerOpen(true);
      }
    });
    scatterplot.subscribe("deselect", () => {
      setSelectedPoint(null);
    });

    // Resolve label tm coords to indices and track positions on view change
    const labels = data.scatter.labels ?? [];
    const tmToIdx = new Map<number, number>();
    if (tmCoords) {
      for (let i = 0; i < n; i++) tmToIdx.set(tmCoords[i], i);
    }
    const labelIndices = labels
      .map((l) => ({ label: l.label, idx: tmToIdx.get(l.tm) ?? -1 }))
      .filter((l) => l.idx >= 0);

    // Create label DOM elements and update positions directly (no React state)
    const layer = labelLayerRef.current;
    const labelEls: HTMLDivElement[] = [];
    if (layer) {
      layer.innerHTML = "";
      for (const { label, idx } of labelIndices) {
        const el = document.createElement("div");
        el.className = "tm-space-label";
        el.textContent = label;
        el.addEventListener("click", () => {
          setSelectedPoint(idx);
          setDrawerOpen(true);
          setDrawerUserClosed(false);
        });
        layer.appendChild(el);
        labelEls.push(el);
      }
    }

    const updateLabelPositions = () => {
      for (let i = 0; i < labelIndices.length; i++) {
        const pos = scatterplot.getScreenPosition(labelIndices[i].idx);
        if (pos) {
          labelEls[i].style.transform = `translate(${pos[0]}px, ${pos[1]}px)`;
        }
      }
    };

    scatterplot.subscribe("view", updateLabelPositions);
    scatterplot.subscribe("draw", updateLabelPositions);

    return () => {
      ro.disconnect();
      scatterplot.destroy();
      scatterplotRef.current = null;
    };
  }, [xy, numPoints, tmCoords, data.scatter.labels]);

  // ---------- Update colors + filter opacity in a single draw ----------

  useEffect(() => {
    const scatterplot = scatterplotRef.current;
    if (!scatterplot || !xy) return;

    const spec = data.scatter.color_arrays.find((c) => c.name === activeColor);
    const values = colorArrays.get(activeColor);
    if (!spec || !values) return;

    let cancelled = false;
    const n = numPoints;

    // Build w channel for opacity filtering
    let hasFilter = false;
    const w = new Float32Array(n);
    if (spec.type === "continuous" && colorRange) {
      const [lo, hi] = colorRange;
      for (let i = 0; i < n; i++) w[i] = (values[i] >= lo && values[i] <= hi) ? 1 : 0;
      hasFilter = true;
    } else if (spec.type === "categorical" && hiddenCategories.size > 0) {
      for (let i = 0; i < n; i++) w[i] = hiddenCategories.has(values[i]) ? 0 : 1;
      hasFilter = true;
    } else {
      for (let i = 0; i < n; i++) w[i] = 1;
    }

    drawPromiseRef.current.then(() => {
      if (cancelled || !scatterplotRef.current) return;

      // Set opacity mode
      if (hasFilter) {
        scatterplot.set({ opacityBy: "w", opacity: [0.03, 0.8] });
      } else {
        scatterplot.set({ opacityBy: null, opacity: 0.8 });
      }

      if (spec.type === "categorical") {
        const unique = [...new Set(Array.from(values))].sort((a, b) => a - b);
        const valToIdx = new Map(unique.map((v, i) => [v, i]));

        const z = new Float32Array(n);
        for (let i = 0; i < n; i++) z[i] = valToIdx.get(values[i]) ?? 0;

        const colorMap = unique.map((_, i) => {
          const c = CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length];
          return [c[0] / 255, c[1] / 255, c[2] / 255, c[3] / 255] as [number, number, number, number];
        });

        scatterplot.set({ colorBy: "z", pointColor: colorMap });
        drawPromiseRef.current = scatterplot.draw(
          { x: xyX(xy, n), y: xyY(xy, n), z, w },
          { zDataType: "categorical" },
        );
      } else {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < n; i++) {
          if (values[i] < min) min = values[i];
          if (values[i] > max) max = values[i];
        }
        const range = max - min || 1;
        const z = new Float32Array(n);
        for (let i = 0; i < n; i++) z[i] = (values[i] - min) / range;

        const colorMap = VIRIDIS.map(
          (c) => [c[0] / 255, c[1] / 255, c[2] / 255, 1] as [number, number, number, number],
        );

        scatterplot.set({ colorBy: "z", pointColor: colorMap });
        drawPromiseRef.current = scatterplot.draw(
          { x: xyX(xy, n), y: xyY(xy, n), z, w },
          { zDataType: "continuous" },
        );
      }
    });

    return () => { cancelled = true; };
  }, [activeColor, colorArrays, xy, numPoints, colorRange, hiddenCategories, data.scatter.color_arrays]);

  // Nudge resize-dependent components when drawer opens/closes
  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    return () => clearTimeout(id);
  }, [drawerOpen]);

  // Update point size
  useEffect(() => {
    const scatterplot = scatterplotRef.current;
    if (scatterplot) scatterplot.set({ pointSize });
  }, [pointSize]);


  // Open drawer on select (but respect user-closed state)
  useEffect(() => {
    if (selectedPoint != null) {
      setDrawerOpen(true);
      setDrawerUserClosed(false);
    }
  }, [selectedPoint]);

  // Active color spec for legend
  const activeColorSpec = data.scatter.color_arrays.find((c) => c.name === activeColor);
  const activeColorValues = colorArrays.get(activeColor) ?? null;

  if (loading) {
    return <div className="tm-space-loading">Loading TM space data...</div>;
  }
  if (error) {
    return <div className="tm-space-error">Error: {error}</div>;
  }

  return (
    <div className="tm-space-pane">
      {/* Top bar */}
      <div className="tm-space-toolbar">
        {headerControls}
        <div className="tm-space-toolbar-controls">
          <label className="tm-space-color-select">
            Color:
            <select
              value={activeColor}
              onChange={(e) => { setActiveColor(e.target.value); setColorRange(null); setHiddenCategories(new Set()); }}
            >
              {data.scatter.color_arrays.map((c) => (
                <option key={c.name} value={c.name}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="tm-space-size-control">
            Size:
            <input
              type="range"
              min={1}
              max={50}
              value={pointSize}
              onChange={(e) => setPointSize(parseInt(e.target.value))}
            />
          </label>
          <span className="tm-space-point-count">
            {numPoints.toLocaleString()} points
          </span>
          <span className="tm-space-search">
            <input
              type="text"
              placeholder="tm id"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            />
          </span>
          {activeColorSpec && (
            <ColorLegend
              values={activeColorValues}
              spec={activeColorSpec}
              colorRange={colorRange}
              onColorRangeChange={setColorRange}
              hiddenCategories={hiddenCategories}
              onHiddenCategoriesChange={setHiddenCategories}
            />
          )}
        </div>
        <span className="tm-space-focused-info">
          {focusedPoint != null ? (
            <>
              <span className="tm-space-focused-tm">tm {focusedTmCoord ?? focusedPoint}</span>
              {activeColorValues && activeColorSpec ? (
                <span className="tm-space-focused-val">{activeColorSpec.label}: {
                  activeColorSpec.type === "categorical"
                    ? activeColorValues[focusedPoint]
                    : activeColorValues[focusedPoint].toFixed(4)
                }</span>
              ) : null}
            </>
          ) : "\u00a0"}
        </span>
      </div>

      {/* Main content area */}
      <div className="tm-space-content">
        {/* Scatter canvas */}
        <div
          ref={containerRef}
          className={`tm-space-canvas-container ${drawerOpen ? "tm-space-canvas-shrunk" : ""}`}
        >
          <canvas ref={canvasRef} className="tm-space-canvas" />
          <div ref={labelLayerRef} className="tm-space-label-layer" />
          {!drawerOpen && (
            <button
              className="tm-space-drawer-toggle"
              onClick={() => { setDrawerOpen(true); setDrawerUserClosed(false); }}
              title="Open detail panel"
            >
              ‹
            </button>
          )}
        </div>

        {/* Drawer */}
        <div
          className={`tm-space-drawer ${drawerOpen ? "tm-space-drawer-open" : ""}`}
          style={drawerOpen ? { width: drawerWidth } : undefined}
        >
          {drawerOpen && (
            <div className="tm-space-drawer-resize" onMouseDown={onResizeStart} />
          )}
          <div className="tm-space-drawer-header">
            <div className="tm-space-drawer-tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`tm-space-drawer-tab ${activeTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              className="tm-space-drawer-close"
              onClick={() => { setDrawerOpen(false); setDrawerUserClosed(true); setSelectedPoint(null); }}
              title="Close"
            >
              ×
            </button>
          </div>
          <div className="tm-space-drawer-body">
            {focusedPoint == null ? (
              <div className="tm-space-detail-empty">
                Hover or click a point to see details
              </div>
            ) : (
              <>
                {activeTab === "code" && data.code_browser && (
                  <DrawerCodeBrowser
                    config={data.code_browser}
                    tmIndex={focusedPoint}
                    tmCoord={focusedTmCoord ?? focusedPoint}
                  />
                )}
                {data.detail_panels?.map((panel) => {
                  if (activeTab !== `panel_${panel.label}`) return null;
                  // Custom component dispatch
                  if (panel.component) {
                    const Comp = TM_SPACE_PANEL_REGISTRY[panel.component];
                    if (!Comp) {
                      return (
                        <div key={panel.label} style={{ padding: 12, color: "#b91c1c" }}>
                          Unknown component: <code>{panel.component}</code>.
                          Available: <code>{Object.keys(TM_SPACE_PANEL_REGISTRY).join(", ")}</code>.
                        </div>
                      );
                    }
                    return (
                      <Comp
                        key={panel.label}
                        tmIndex={focusedPoint}
                        tmCoord={focusedTmCoord ?? focusedPoint}
                        zarrGroup={panel.zarr_group}
                        params={panel.params}
                      />
                    );
                  }
                  // Legacy figure-template path
                  if (!panel.figure || !panel.zarr_uri) {
                    return (
                      <div key={panel.label} style={{ padding: 12, color: "#b91c1c" }}>
                        Panel <code>{panel.label}</code> missing figure or zarr_uri.
                      </div>
                    );
                  }
                  return (
                    <DetailPanel
                      key={panel.label}
                      panel={{ label: panel.label, figure: panel.figure, zarr_uri: panel.zarr_uri }}
                      tmIndex={focusedPoint}
                    />
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to split interleaved xy into separate x/y arrays
function xyX(xy: Float32Array, n: number): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = xy[i * 2];
  return x;
}

function xyY(xy: Float32Array, n: number): Float32Array {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = xy[i * 2 + 1];
  return y;
}
