import { useCallback, useEffect, useRef, useState } from "react";
import Plot from "../plotly";

const API_URL = import.meta.env.VITE_API_URL || "https://strata.timaeus-research-inc.workers.dev";

/** Build the R2 fetch URL for an artifact.
 *
 *  `version` is appended as a `?v=` cache buster. Pass the artifact's
 *  content_hash or updated_at so re-uploads bypass the browser/CDN
 *  cache without needing a hard refresh. R2 paths themselves remain
 *  stable: only the URL the browser sees changes. */
export function getPlotUrl(uri: string, version?: string | null) {
  const v = version ?? "3";
  return `${API_URL}/data/r2/${uri}?v=${encodeURIComponent(v)}`;
}

export function downloadBlob(url: string, filename: string) {
  fetch(url)
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    });
}

// Module-level caches
const htmlCache = new Map<string, string>();
const jsonCache = new Map<string, { data: any[]; layout: any }>();

// View lock state: 2D axis ranges
interface ViewLockState {
  axes: Record<string, { range: [number, number] }>;
}

function formatViewLock(z: ViewLockState | null | undefined): string {
  if (!z) return "—";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(z.axes)) parts.push(`${k}:[${v.range[0].toFixed(1)},${v.range[1].toFixed(1)}]`);
  return parts.join(" ") || "—";
}

function ViewLockCheckbox({ locked, onToggle, state }: { locked: boolean; onToggle: (v: boolean) => void; state?: ViewLockState | null }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", color: "#6b7280", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
      <input type="checkbox" checked={locked} onChange={(e) => onToggle(e.target.checked)} style={{ margin: 0 }} />
      Lock view
      <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "#9ca3af", marginLeft: "0.25rem" }}>{formatViewLock(state)}</span>
    </label>
  );
}

/** Prefetch plot data for a list of URIs so they render instantly on tab switch. */
export function prefetchPlots(items: Array<{ uri: string; version?: string | null }>) {
  for (const { uri, version } of items) {
    const url = getPlotUrl(uri, version);
    if (!htmlCache.has(url) && !jsonCache.has(url)) {
      fetch(url).then(async (r) => {
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("json")) {
          const j = await r.json();
          jsonCache.set(url, { data: j.data, layout: j.layout });
        } else {
          const h = await r.text();
          htmlCache.set(url, h);
        }
      }).catch(() => {});
    }
  }
}

/** Fetch HTML, load via srcdoc (same-origin), auto-resize to content. */
function usePlotHtml(uri: string | null, version?: string | null) {
  const url = uri ? getPlotUrl(uri, version) : null;
  const [html, setHtml] = useState<string | null>((url && htmlCache.get(url)) ?? null);

  useEffect(() => {
    if (!url) return;
    if (htmlCache.has(url)) { setHtml(htmlCache.get(url)!); return; }
    fetch(url).then((r) => r.text()).then((h) => { htmlCache.set(url, h); setHtml(h); }).catch(() => {});
  }, [url]);

  return { html, url };
}

/** Fetch Plotly JSON figure spec. */
function usePlotJson(uri: string | null, version?: string | null) {
  const url = uri ? getPlotUrl(uri, version) : null;
  const [figure, setFigure] = useState<{ data: any[]; layout: any } | null>((url && jsonCache.get(url)) || null);

  useEffect(() => {
    if (!url) return;
    if (jsonCache.has(url)) { setFigure(jsonCache.get(url)!); return; }
    fetch(url).then((r) => r.json()).then((j: any) => {
      const fig = { data: j.data, layout: j.layout };
      jsonCache.set(url, fig);
      setFigure(fig);
    }).catch(() => {});
  }, [url]);

  return { figure, url };
}

/** Read current 2D axis ranges from a live plotly div. Returns null for 3D-only plots. */
function readViewFromPlotly(el: any): ViewLockState | null {
  const liveLayout = el?.layout;
  if (!liveLayout) return null;
  const axes: ViewLockState["axes"] = {};
  for (const key of Object.keys(liveLayout)) {
    if (/^[xy]axis\d*$/.test(key)) {
      const ax = liveLayout[key];
      if (ax?.range?.length === 2) axes[key] = { range: [ax.range[0], ax.range[1]] };
    }
  }
  if (Object.keys(axes).length === 0) return null;
  return { axes };
}

/** Render a Plotly figure from JSON — no iframe needed.
 *  When zoomState is provided, axis ranges are overridden.
 *  onZoomChange reports current view state on every relayout. */
function PlotlyDirect({ uri, version, title: _title, zoomState, onZoomChange, plotElRef }: {
  uri: string; version?: string | null; title: string;
  zoomState?: ViewLockState | null;
  onZoomChange?: (zoom: ViewLockState) => void;
  plotElRef?: React.MutableRefObject<any>;
}) {
  const { figure } = usePlotJson(uri, version);
  const plotRef = useRef<any>(null);
  // Skip relayout events briefly after mount/zoom-apply to avoid feedback loops
  const suppressRef = useRef(true);
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  useEffect(() => {
    suppressRef.current = true;
    const id = setTimeout(() => { suppressRef.current = false; }, 300);
    return () => clearTimeout(id);
  }, [uri, version, zoomState]);

  // Register plotly element with parent for direct reads (e.g. on checkbox toggle)
  useEffect(() => {
    if (plotElRef) plotElRef.current = plotRef.current?.el ?? null;
  });

  // Attach plotly_relayout listener for 2D axis changes
  useEffect(() => {
    const el = plotRef.current?.el;
    if (!el || !el.on) return;

    const handler = () => {
      if (suppressRef.current || !onZoomChangeRef.current) return;
      const view = readViewFromPlotly(el);
      if (view) onZoomChangeRef.current(view);
    };

    el.on("plotly_relayout", handler);
    return () => { el.removeListener?.("plotly_relayout", handler); };
  });

  if (!figure) return <div style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}>Loading plot...</div>;

  const layout: any = { ...figure.layout, autosize: true };
  if (zoomState) {
    for (const [axis, state] of Object.entries(zoomState.axes)) {
      layout[axis] = { ...(layout[axis] || {}), range: [...state.range], autorange: false };
    }
  }

  return (
    <Plot
      // @ts-expect-error react-plotly.js types lack ref but it works at runtime
      ref={plotRef}
      data={figure.data}
      layout={layout}
      config={{ responsive: true }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function AutoIframe({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const handleLoad = () => {
      const doc = iframe.contentDocument;
      if (doc) {
        // Measure after Plotly renders
        const measure = () => {
          const h = Math.max(
            doc.body.scrollHeight,
            doc.documentElement.scrollHeight,
          );
          if (h > 50) setHeight(h);
        };
        setTimeout(measure, 300);
        setTimeout(measure, 1000);
        // Also observe resizes (e.g. Plotly responsive relayout)
        const observer = new ResizeObserver(measure);
        observer.observe(doc.body);
        return () => observer.disconnect();
      }
    };

    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [html]);

  return (
    <iframe
      ref={ref}
      srcDoc={html}
      style={{ width: "100%", height: `${height}px`, border: "none", display: "block" }}
      title={title}
    />
  );
}

export interface PlotActions {
  openUrls: { label: string; url: string }[];
  download: () => void;
  downloadJson?: () => void;
}

interface PlotArtifactProps {
  uri: string;
  html_uri?: string;
  /** Cache-bust token — usually the artifact's content_hash or updated_at. */
  version?: string | null;
  label: string;
  artifact_type?: string;
  headless?: boolean;
  onActions?: (actions: PlotActions) => void;
}

export function PlotArtifact({ uri, html_uri, version, label, artifact_type, headless, onActions }: PlotArtifactProps) {
  const isJson = artifact_type === "plotly_json";
  const isPng = artifact_type === "png";
  const [collapsed, setCollapsed] = useState(false);
  // Always call both hooks (Rules of Hooks) — pass null to skip the inactive one
  const { html, url: htmlUrl } = usePlotHtml(isJson || isPng ? null : uri, version);
  const { figure, url: jsonUrl } = usePlotJson(isJson ? uri : null, version);
  // For Open/Download: always use HTML version (or PNG bytes when PNG)
  const openUrl = isPng
    ? getPlotUrl(uri, version)
    : isJson && html_uri ? getPlotUrl(html_uri, version) : (htmlUrl || getPlotUrl(uri, version));
  // For action bar display URL
  const url = isPng ? getPlotUrl(uri, version) : ((isJson ? jsonUrl : htmlUrl) || getPlotUrl(uri, version));

  useEffect(() => {
    const downloadExt = isPng ? "png" : "html";
    const actions: PlotActions = {
      openUrls: [{ label: "Open", url: openUrl }],
      download: () => downloadBlob(openUrl, `${label}.${downloadExt}`),
    };
    if (isJson) {
      actions.downloadJson = () => downloadBlob(getPlotUrl(uri, version), `${label}.json`);
    }
    onActions?.(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, label]);

  const plotContent = isPng
    ? <ImagePlot uri={uri} version={version} title={label} />
    : isJson
      ? (figure ? <PlotlyDirect uri={uri} version={version} title={label} /> : <div style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}>Loading plot...</div>)
      : (html ? <AutoIframe html={html} title={label} /> : <div style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}>Loading plot...</div>);

  if (headless) return <>{plotContent}</>;

  return (
    <div className="plot-artifact">
      <div className="plot-header">
        <button
          className="plot-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "+" : "-"}
        </button>
        <span className="plot-label">{label}</span>
        <div className="plot-actions">
          <a href={openUrl} target="_blank" rel="noopener noreferrer" className="btn-icon">Open</a>
          <button className="btn-icon" onClick={() => downloadBlob(openUrl, `${label}.${isPng ? "png" : "html"}`)}>{isPng ? "PNG" : "HTML"}</button>
          {isJson && <button className="btn-icon" onClick={() => downloadBlob(getPlotUrl(uri, version), `${label}.json`)}>JSON</button>}
        </div>
      </div>
      {!collapsed && plotContent}
    </div>
  );
}

export interface PlotMember {
  uri: string;
  html_uri?: string;
  /** Cache-bust token — usually the artifact's content_hash or updated_at. */
  version?: string | null;
  label: string;
  artifact_type?: string;
  params?: Record<string, any>;
}

/** Get the Open/Download HTML URL for a member. */
function memberHtmlUrl(m: PlotMember): string {
  if (m.artifact_type === "plotly_json" && m.html_uri) return getPlotUrl(m.html_uri, m.version);
  return getPlotUrl(m.uri, m.version);
}

/** Render a PNG artifact as an <img> sized to the container. */
function ImagePlot({ uri, version, title }: { uri: string; version?: string | null; title: string }) {
  return (
    <img
      src={getPlotUrl(uri, version)}
      alt={title}
      style={{ display: "block", maxWidth: "100%", height: "auto", margin: "0 auto" }}
    />
  );
}

/** Render a single plot member — either PlotlyDirect, ImagePlot, or AutoIframe via HTML cache. */
function MemberPlot({ member, htmlData, zoomState, onZoomChange, plotElRef }: {
  member: PlotMember; htmlData: string | null;
  zoomState?: ViewLockState | null;
  onZoomChange?: (zoom: ViewLockState) => void;
  plotElRef?: React.MutableRefObject<any>;
}) {
  if (member.artifact_type === "plotly_json") {
    return <PlotlyDirect uri={member.uri} version={member.version} title={member.label} zoomState={zoomState} onZoomChange={onZoomChange} plotElRef={plotElRef} />;
  }
  if (member.artifact_type === "png") {
    return <ImagePlot uri={member.uri} version={member.version} title={member.label} />;
  }
  if (htmlData) return <AutoIframe html={htmlData} title={member.label} />;
  return <div style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}>Loading plot...</div>;
}

interface PlotGroupProps {
  label: string;
  artifacts: PlotMember[];
  headless?: boolean;
  onActions?: (actions: PlotActions) => void;
  selectedParams?: Record<string, string>;
  onSelectedParamsChange?: (params: Record<string, string>) => void;
}

function paramsToIndex(artifacts: PlotMember[], params?: Record<string, string>): number {
  if (!params) return 0;
  const idx = artifacts.findIndex((a) =>
    Object.entries(params).every(([k, v]) => String(a.params?.[k] ?? "") === v)
  );
  return idx >= 0 ? idx : 0;
}

function indexToParams(artifact: PlotMember): Record<string, string> {
  if (!artifact.params) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(artifact.params)) result[k] = String(v);
  return result;
}

/** Hook: zoom lock for a family of plots.
 *  Returns [lockedZoom, onZoomChange, isLocked, toggleLock]. */
interface FamilyZoom {
  zoomState: ViewLockState | null;
  onZoomChange: ((z: ViewLockState) => void) | undefined;
  isLocked: boolean;
  toggleLock: (v: boolean) => void;
  /** Ref for PlotlyDirect to register its plotly element */
  plotElRef: React.MutableRefObject<any>;
}

function useFamilyZoom(enabled: boolean): FamilyZoom {
  const [lockedZoom, setLockedZoom] = useState<ViewLockState | null>(null);
  const lockedRef = useRef(false);
  lockedRef.current = lockedZoom !== null;
  const latestRef = useRef<ViewLockState | null>(null);
  const plotElRef = useRef<any>(null);

  // Always track latest zoom (into ref, no state update unless locked)
  const handleZoomChange = useCallback((z: ViewLockState) => {
    latestRef.current = z;
    if (lockedRef.current) setLockedZoom(z);
  }, []);

  const toggleLock = useCallback((checked: boolean) => {
    if (checked) {
      // Read directly from the live plotly element
      const fromPlot = readViewFromPlotly(plotElRef.current);
      setLockedZoom(fromPlot ?? latestRef.current);
    } else {
      setLockedZoom(null);
    }
  }, []);

  return {
    zoomState: lockedZoom,
    onZoomChange: enabled ? handleZoomChange : undefined,
    isLocked: lockedZoom !== null,
    toggleLock,
    plotElRef,
  };
}

export function PlotGroup({ label, artifacts, headless, onActions, selectedParams, onSelectedParamsChange }: PlotGroupProps) {
  const [internalSelected, setInternalSelected] = useState(() => paramsToIndex(artifacts, selectedParams));
  const selected = selectedParams ? paramsToIndex(artifacts, selectedParams) : internalSelected;
  const setSelected = (i: number) => {
    setInternalSelected(i);
    onSelectedParamsChange?.(indexToParams(artifacts[i]));
  };
  const [collapsed, setCollapsed] = useState(false);
  const isJson = artifacts[0]?.artifact_type === "plotly_json";
  const isPng = artifacts[0]?.artifact_type === "png";
  const { zoomState, onZoomChange, isLocked: isZoomLocked, toggleLock: toggleZoomLock, plotElRef } = useFamilyZoom(isJson && artifacts.length > 1);
  const showZoomLock = isJson && artifacts.length > 1;
  // Fetch all HTML upfront (skipped for JSON/PNG — PlotlyDirect/ImagePlot handle their own loading)
  const plots = artifacts.map((a) => usePlotHtml(isJson || isPng ? null : a.uri));

  useEffect(() => {
    if (!onActions || artifacts.length === 0) return;
    const m = artifacts[selected];
    const htmlUrl = memberHtmlUrl(m);
    const ext = isPng ? "png" : "html";
    const actions: PlotActions = {
      openUrls: [{ label: `Open ${m.label}`, url: htmlUrl }],
      download: () => downloadBlob(htmlUrl, `${m.label}.${ext}`),
    };
    if (isJson) actions.downloadJson = () => downloadBlob(getPlotUrl(m.uri, m.version), `${m.label}.json`);
    onActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (artifacts.length === 0) return null;
  if (artifacts.length === 1) {
    const a = artifacts[0];
    return <PlotArtifact uri={a.uri} html_uri={a.html_uri} label={a.label} artifact_type={a.artifact_type} headless={headless} onActions={onActions} />;
  }

  const currentHtmlUrl = memberHtmlUrl(artifacts[selected]);

  if (headless) {
    return (
      <div>
        <div className="plot-controls plot-tabs">
          {artifacts.map((a, i) => (
            <button
              key={i}
              className={`plot-tab ${i === selected ? "active" : ""}`}
              onClick={() => setSelected(i)}
            >
              {a.label}
            </button>
          ))}
          {showZoomLock && <ViewLockCheckbox locked={isZoomLocked} onToggle={toggleZoomLock} state={zoomState} />}
        </div>
        {artifacts.map((a, i) => (
          <div key={i} style={{ display: i === selected ? "block" : "none" }}>
            <MemberPlot member={a} htmlData={plots[i]?.html ?? null} zoomState={zoomState} onZoomChange={onZoomChange} plotElRef={plotElRef} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="plot-artifact">
      <div className="plot-header">
        <button
          className="plot-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "+" : "-"}
        </button>
        <span className="plot-label">{label}</span>
        <div className="plot-tabs">
          {artifacts.map((a, i) => (
            <button
              key={i}
              className={`plot-tab ${i === selected ? "active" : ""}`}
              onClick={() => setSelected(i)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {showZoomLock && <ViewLockCheckbox locked={isZoomLocked} onToggle={toggleZoomLock} state={zoomState} />}
        <div className="plot-actions">
          <a href={currentHtmlUrl} target="_blank" rel="noopener noreferrer" className="btn-icon">Open</a>
          <button className="btn-icon" onClick={() => downloadBlob(currentHtmlUrl, `${artifacts[selected].label}.${isPng ? "png" : "html"}`)}>{isPng ? "PNG" : "HTML"}</button>
          {isJson && <button className="btn-icon" onClick={() => downloadBlob(getPlotUrl(artifacts[selected].uri, artifacts[selected].version), `${artifacts[selected].label}.json`)}>JSON</button>}
        </div>
      </div>
      {!collapsed && artifacts.map((a, i) => (
        <div key={i} style={{ display: i === selected ? "block" : "none" }}>
          <MemberPlot member={a} htmlData={plots[i]?.html ?? null} zoomState={zoomState} onZoomChange={onZoomChange} plotElRef={plotElRef} />
        </div>
      ))}
    </div>
  );
}

/** Dropdown selector — one artifact visible at a time, chosen via <select>. */
export function PlotDropdown({ label, artifacts, headless, onActions, selectedParams, onSelectedParamsChange }: PlotGroupProps) {
  const [internalSelected, setInternalSelected] = useState(() => paramsToIndex(artifacts, selectedParams));
  const selected = selectedParams ? paramsToIndex(artifacts, selectedParams) : internalSelected;
  const setSelected = (i: number) => {
    setInternalSelected(i);
    onSelectedParamsChange?.(indexToParams(artifacts[i]));
  };
  const [collapsed, setCollapsed] = useState(false);
  const isJson = artifacts[0]?.artifact_type === "plotly_json";
  const isPng = artifacts[0]?.artifact_type === "png";
  const { zoomState, onZoomChange, isLocked: isZoomLocked, toggleLock: toggleZoomLock, plotElRef } = useFamilyZoom(isJson && artifacts.length > 1);
  const showZoomLock = isJson && artifacts.length > 1;
  const plots = artifacts.map((a) => usePlotHtml(isJson || isPng ? null : a.uri));

  useEffect(() => {
    if (!onActions || artifacts.length === 0) return;
    const m = artifacts[selected];
    const htmlUrl = memberHtmlUrl(m);
    const ext = isPng ? "png" : "html";
    const actions: PlotActions = {
      openUrls: [{ label: `Open ${m.label}`, url: htmlUrl }],
      download: () => downloadBlob(htmlUrl, `${m.label}.${ext}`),
    };
    if (isJson) actions.downloadJson = () => downloadBlob(getPlotUrl(m.uri, m.version), `${m.label}.json`);
    onActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (artifacts.length === 0) return null;
  if (artifacts.length === 1) {
    const a = artifacts[0];
    return <PlotArtifact uri={a.uri} html_uri={a.html_uri} label={a.label} artifact_type={a.artifact_type} headless={headless} onActions={onActions} />;
  }

  const currentHtmlUrl = memberHtmlUrl(artifacts[selected]);

  if (headless) {
    return (
      <div>
        <div className="plot-controls" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <select
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
            style={{ fontSize: "0.85rem", padding: "2px 6px" }}
          >
            {artifacts.map((a, i) => (
              <option key={i} value={i}>{a.label}</option>
            ))}
          </select>
          {showZoomLock && <ViewLockCheckbox locked={isZoomLocked} onToggle={toggleZoomLock} state={zoomState} />}
        </div>
        {artifacts.map((a, i) => (
          <div key={i} style={{ display: i === selected ? "block" : "none" }}>
            <MemberPlot member={a} htmlData={plots[i]?.html ?? null} zoomState={zoomState} onZoomChange={onZoomChange} plotElRef={plotElRef} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="plot-artifact">
      <div className="plot-header">
        <button
          className="plot-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "+" : "-"}
        </button>
        <span className="plot-label">{label}</span>
        <select
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
          style={{ marginLeft: "0.5rem", fontSize: "0.85rem", padding: "2px 6px" }}
        >
          {artifacts.map((a, i) => (
            <option key={i} value={i}>{a.label}</option>
          ))}
        </select>
        {showZoomLock && <ViewLockCheckbox locked={isZoomLocked} onToggle={toggleZoomLock} state={zoomState} />}
        <div className="plot-actions">
          <a href={currentHtmlUrl} target="_blank" rel="noopener noreferrer" className="btn-icon">Open</a>
          <button className="btn-icon" onClick={() => downloadBlob(currentHtmlUrl, `${artifacts[selected].label}.${isPng ? "png" : "html"}`)}>{isPng ? "PNG" : "HTML"}</button>
          {isJson && <button className="btn-icon" onClick={() => downloadBlob(getPlotUrl(artifacts[selected].uri, artifacts[selected].version), `${artifacts[selected].label}.json`)}>JSON</button>}
        </div>
      </div>
      {!collapsed && artifacts.map((a, i) => (
        <div key={i} style={{ display: i === selected ? "block" : "none" }}>
          <MemberPlot member={a} htmlData={plots[i]?.html ?? null} zoomState={zoomState} onZoomChange={onZoomChange} plotElRef={plotElRef} />
        </div>
      ))}
    </div>
  );
}

/** Range slider — for numeric params. Shows value label + scrubs between artifacts. */
export function PlotSlider({ label, artifacts, headless, onActions, selectedParams, onSelectedParamsChange }: PlotGroupProps) {
  const [internalSelected, setInternalSelected] = useState(() => paramsToIndex(artifacts, selectedParams));
  const selected = selectedParams ? paramsToIndex(artifacts, selectedParams) : internalSelected;
  const setSelected = (i: number) => {
    setInternalSelected(i);
    onSelectedParamsChange?.(indexToParams(artifacts[i]));
  };
  const [collapsed, setCollapsed] = useState(false);
  const isJson = artifacts[0]?.artifact_type === "plotly_json";
  const isPng = artifacts[0]?.artifact_type === "png";
  const { zoomState, onZoomChange, isLocked: isZoomLocked, toggleLock: toggleZoomLock, plotElRef } = useFamilyZoom(isJson && artifacts.length > 1);
  const showZoomLock = isJson && artifacts.length > 1;
  const plots = artifacts.map((a) => usePlotHtml(isJson || isPng ? null : a.uri));

  useEffect(() => {
    if (!onActions || artifacts.length === 0) return;
    const m = artifacts[selected];
    const htmlUrl = memberHtmlUrl(m);
    const ext = isPng ? "png" : "html";
    const actions: PlotActions = {
      openUrls: [{ label: `Open ${m.label}`, url: htmlUrl }],
      download: () => downloadBlob(htmlUrl, `${m.label}.${ext}`),
    };
    if (isJson) actions.downloadJson = () => downloadBlob(getPlotUrl(m.uri, m.version), `${m.label}.json`);
    onActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (artifacts.length === 0) return null;
  if (artifacts.length === 1) {
    const a = artifacts[0];
    return <PlotArtifact uri={a.uri} html_uri={a.html_uri} label={a.label} artifact_type={a.artifact_type} headless={headless} onActions={onActions} />;
  }

  const currentHtmlUrl = memberHtmlUrl(artifacts[selected]);

  if (headless) {
    return (
      <div>
        <div className="plot-controls" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input type="range" min={0} max={artifacts.length - 1} value={selected}
            onChange={(e) => setSelected(Number(e.target.value))} style={{ flex: 1, maxWidth: "200px" }} />
          <span style={{ fontSize: "0.85rem", fontWeight: 500, minWidth: "60px" }}>{artifacts[selected].label}</span>
          {showZoomLock && <ViewLockCheckbox locked={isZoomLocked} onToggle={toggleZoomLock} state={zoomState} />}
        </div>
        {artifacts.map((a, i) => (
          <div key={i} style={{ display: i === selected ? "block" : "none" }}>
            <MemberPlot member={a} htmlData={plots[i]?.html ?? null} zoomState={zoomState} onZoomChange={onZoomChange} plotElRef={plotElRef} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="plot-artifact">
      <div className="plot-header">
        <button className="plot-collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "+" : "-"}
        </button>
        <span className="plot-label">{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "0.5rem", flex: 1 }}>
          <input type="range" min={0} max={artifacts.length - 1} value={selected}
            onChange={(e) => setSelected(Number(e.target.value))} style={{ flex: 1, maxWidth: "200px" }} />
          <span style={{ fontSize: "0.85rem", fontWeight: 500, minWidth: "60px" }}>{artifacts[selected].label}</span>
        </div>
        {showZoomLock && <ViewLockCheckbox locked={isZoomLocked} onToggle={toggleZoomLock} state={zoomState} />}
        <div className="plot-actions">
          <a href={currentHtmlUrl} target="_blank" rel="noopener noreferrer" className="btn-icon">Open</a>
          <button className="btn-icon" onClick={() => downloadBlob(currentHtmlUrl, `${artifacts[selected].label}.${isPng ? "png" : "html"}`)}>{isPng ? "PNG" : "HTML"}</button>
          {isJson && <button className="btn-icon" onClick={() => downloadBlob(getPlotUrl(artifacts[selected].uri, artifacts[selected].version), `${artifacts[selected].label}.json`)}>JSON</button>}
        </div>
      </div>
      {!collapsed && artifacts.map((a, i) => (
        <div key={i} style={{ display: i === selected ? "block" : "none" }}>
          <MemberPlot member={a} htmlData={plots[i]?.html ?? null} zoomState={zoomState} onZoomChange={onZoomChange} plotElRef={plotElRef} />
        </div>
      ))}
    </div>
  );
}

type ParamLayout = string | { mode: string; default?: string };

interface PlotMultiDropdownProps {
  label: string;
  artifacts: PlotMember[];
  paramKeys: string[];
  paramModes?: Record<string, ParamLayout>;
  headless?: boolean;
  onActions?: (actions: PlotActions) => void;
  selectedParams?: Record<string, string>;
  onSelectedParamsChange?: (params: Record<string, string>) => void;
}

function getParamMode(layout: ParamLayout | undefined): string {
  if (!layout) return "dropdown";
  return typeof layout === "string" ? layout : layout.mode;
}

function getParamDefault(layout: ParamLayout | undefined): string | undefined {
  if (!layout || typeof layout === "string") return undefined;
  return layout.default;
}

/** Whether `current` (a complete param tuple) corresponds to an artifact in the family. */
function tupleExists(artifacts: PlotMember[], paramKeys: string[], current: Record<string, string>): boolean {
  return artifacts.some((a) => paramKeys.every((k) => String(a.params?.[k] ?? "") === current[k]));
}

/** Pick the nearest value in `candidates` to `target`. Numeric if both parse, else lexicographic distance. */
function nearestValue(target: string, candidates: string[]): string {
  if (candidates.length === 0) return target;
  if (candidates.includes(target)) return target;
  const tn = Number(target);
  if (!isNaN(tn) && candidates.every((c) => !isNaN(Number(c)))) {
    let best = candidates[0];
    let bestDist = Math.abs(Number(best) - tn);
    for (const c of candidates) {
      const d = Math.abs(Number(c) - tn);
      if (d < bestDist) { best = c; bestDist = d; }
    }
    return best;
  }
  // Lexicographic fallback — pick the candidate with smallest |localeCompare|
  let best = candidates[0];
  let bestDist = Math.abs(best.localeCompare(target));
  for (const c of candidates) {
    const d = Math.abs(c.localeCompare(target));
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

/** Given a desired tuple after a single-key change, snap the other keys (in `paramKeys` order) to the
 *  nearest valid value so the resulting tuple corresponds to an artifact in the family.
 *  Returns the resulting tuple plus a map of which keys were snapped (key -> oldValue). */
function snapToNearest(
  artifacts: PlotMember[],
  paramKeys: string[],
  desired: Record<string, string>,
  changedKey: string,
): { result: Record<string, string>; snaps: Record<string, string> } {
  const result = { ...desired };
  const snaps: Record<string, string> = {};
  if (tupleExists(artifacts, paramKeys, result)) return { result, snaps };
  // Iterate the other keys in paramKeys order, snapping each given the current partial constraints.
  for (const k of paramKeys) {
    if (k === changedKey) continue;
    // Candidates for k: distinct values in artifacts that match all already-fixed keys (changedKey + previously snapped keys + all keys we've already locked above).
    // We treat all keys other than k as fixed by `result` so far.
    const fixedKeys = paramKeys.filter((pk) => pk !== k);
    const candidates = [...new Set(
      artifacts
        .filter((a) => fixedKeys.every((fk) => String(a.params?.[fk] ?? "") === result[fk]))
        .map((a) => String(a.params?.[k] ?? ""))
    )];
    if (candidates.length === 0) continue; // no constraint can be satisfied — leave alone
    const old = result[k];
    const next = nearestValue(old, candidates);
    if (next !== old) {
      snaps[k] = old;
      result[k] = next;
    }
    if (tupleExists(artifacts, paramKeys, result)) break;
  }
  return { result, snaps };
}

/** Multi-dimensional selector — one independent control per param key.
 *  Each key's mode ("dropdown" or "slider") is respected from paramModes. */
export function PlotMultiDropdown({ label, artifacts, paramKeys, paramModes, headless, onActions, selectedParams, onSelectedParamsChange }: PlotMultiDropdownProps) {
  const isJson = artifacts[0]?.artifact_type === "plotly_json";
  const isPng = artifacts[0]?.artifact_type === "png";
  const [collapsed, setCollapsed] = useState(false);
  const { zoomState, onZoomChange, isLocked: isZoomLocked, toggleLock: toggleZoomLock, plotElRef } = useFamilyZoom(isJson && artifacts.length > 1);
  const showZoomLock = isJson && artifacts.length > 1;

  // Distinct sorted values per key (full union across the family)
  const valuesByKey: Record<string, string[]> = {};
  for (const key of paramKeys) {
    const vals = [...new Set(artifacts.map((a) => String(a.params?.[key] ?? "")))];
    vals.sort((a, b) => {
      const na = Number(a), nb = Number(b);
      return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
    });
    valuesByKey[key] = vals;
  }

  const [internalSelected, setInternalSelected] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of paramKeys) init[key] = selectedParams?.[key] ?? getParamDefault(paramModes?.[key]) ?? valuesByKey[key][0] ?? "";
    // Snap initial state to a real artifact if the cartesian default doesn't exist
    if (!tupleExists(artifacts, paramKeys, init) && paramKeys.length > 0) {
      const { result } = snapToNearest(artifacts, paramKeys, init, paramKeys[0]);
      return result;
    }
    return init;
  });
  const rawSelected = selectedParams
    ? Object.fromEntries(paramKeys.map((k) => [k, selectedParams[k] ?? getParamDefault(paramModes?.[k]) ?? valuesByKey[k][0] ?? ""]))
    : internalSelected;
  // If the controlled prop value lands on a non-existent tuple (e.g. partial Cartesian product),
  // snap before using it — this also shields the dropdowns from "ghost" intermediate states.
  const selected: Record<string, string> = tupleExists(artifacts, paramKeys, rawSelected)
    ? rawSelected
    : (paramKeys.length > 0 ? snapToNearest(artifacts, paramKeys, rawSelected, paramKeys[0]).result : rawSelected);

  // Notes left over from the most recent change ("oldValue" remembered per snapped key).
  // Map: paramKey -> the value the user-or-prop tried before we snapped them.
  const [snapNotes, setSnapNotes] = useState<Record<string, string>>({});

  const setSelectedFor = (key: string, newValue: string) => {
    const desired = { ...selected, [key]: newValue };
    const { result, snaps } = snapToNearest(artifacts, paramKeys, desired, key);
    setSnapNotes(snaps);
    setInternalSelected(result);
    onSelectedParamsChange?.(result);
  };

  const current = artifacts.find((a) =>
    paramKeys.every((k) => String(a.params?.[k] ?? "") === selected[k])
  ) ?? artifacts[0];

  // Always call both hooks (Rules of Hooks) — pass null to skip the inactive one
  const { html } = usePlotHtml(isJson || isPng ? null : (current?.uri ?? null));

  useEffect(() => {
    if (!onActions || !current) return;
    const htmlUrl = memberHtmlUrl(current);
    const ext = isPng ? "png" : "html";
    const actions: PlotActions = {
      openUrls: [{ label: "Open", url: htmlUrl }],
      download: () => downloadBlob(htmlUrl, `${label}.${ext}`),
    };
    if (isJson) actions.downloadJson = () => downloadBlob(getPlotUrl(current.uri, current.version), `${label}.json`);
    onActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.uri]);

  if (artifacts.length === 0) return null;
  if (artifacts.length === 1) {
    const a = artifacts[0];
    return <PlotArtifact uri={a.uri} html_uri={a.html_uri} label={a.label} artifact_type={a.artifact_type} headless={headless} onActions={onActions} />;
  }

  // For each key, determine which values are "available" given current selections of *other* keys.
  // A value v is available for key k iff there exists an artifact with params[k]=v and matching the
  // current selection for every other key.
  const availableByKey: Record<string, Set<string>> = {};
  for (const key of paramKeys) {
    const others = paramKeys.filter((k) => k !== key);
    const avail = new Set<string>();
    for (const a of artifacts) {
      if (others.every((ok) => String(a.params?.[ok] ?? "") === selected[ok])) {
        avail.add(String(a.params?.[key] ?? ""));
      }
    }
    availableByKey[key] = avail;
  }

  const selectors = (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
      {paramKeys.map((key) => {
        const vals = valuesByKey[key];
        const avail = availableByKey[key];
        const mode = getParamMode(paramModes?.[key]);
        const idx = vals.indexOf(selected[key]);
        const note = snapNotes[key];
        if (mode === "slider") {
          return (
            <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem" }}>
                <span style={{ color: "#6b7280", fontWeight: 500 }}>{key}</span>
                <input
                  type="range" min={0} max={vals.length - 1} value={idx < 0 ? 0 : idx}
                  onChange={(e) => setSelectedFor(key, vals[Number(e.target.value)])}
                  style={{ width: "80px" }}
                />
                <span style={{ fontWeight: 500, minWidth: "40px" }}>{selected[key]}</span>
              </div>
              {note !== undefined && note !== selected[key] && (
                <span style={{ fontSize: "0.7rem", color: "#9ca3af", fontStyle: "italic" }}>
                  {key} {note} → {selected[key]} (closest available)
                </span>
              )}
            </div>
          );
        }
        return (
          <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.1rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.85rem" }}>
              <span style={{ color: "#6b7280", fontWeight: 500 }}>{key}</span>
              <select
                value={selected[key]}
                onChange={(e) => setSelectedFor(key, e.target.value)}
                style={{ fontSize: "0.85rem", padding: "2px 6px" }}
              >
                {vals.map((v) => (
                  <option key={v} value={v} style={{ fontWeight: avail.has(v) ? 700 : 400 }}>{v}</option>
                ))}
              </select>
            </label>
            {note !== undefined && note !== selected[key] && (
              <span style={{ fontSize: "0.7rem", color: "#9ca3af", fontStyle: "italic" }}>
                {key} {note} → {selected[key]} (closest available)
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  // Single plot mounted at a time — zoom state persists in parent across remounts
  const plotContent = isJson
    ? (current ? <PlotlyDirect key={current.uri} uri={current.uri} title={label} zoomState={zoomState} onZoomChange={onZoomChange} plotElRef={plotElRef} /> : null)
    : isPng
      ? (current ? <ImagePlot key={current.uri} uri={current.uri} title={label} /> : null)
      : (html ? <AutoIframe html={html} title={label} /> : <div style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}>Loading plot...</div>);

  if (headless) {
    return (
      <div>
        <div className="plot-controls" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {selectors}
          {showZoomLock && <ViewLockCheckbox locked={isZoomLocked} onToggle={toggleZoomLock} state={zoomState} />}
        </div>
        {plotContent}
      </div>
    );
  }

  const currentHtmlUrl = current ? memberHtmlUrl(current) : "";
  return (
    <div className="plot-artifact">
      <div className="plot-header">
        <button className="plot-collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "+" : "-"}
        </button>
        <span className="plot-label">{label}</span>
        <div style={{ flex: 1, display: "flex", alignItems: "center", marginLeft: "0.5rem" }}>
          {selectors}
        </div>
        {showZoomLock && <ViewLockCheckbox locked={isZoomLocked} onToggle={toggleZoomLock} state={zoomState} />}
        <div className="plot-actions">
          {current && <a href={currentHtmlUrl} target="_blank" rel="noopener noreferrer" className="btn-icon">Open</a>}
          {current && <button className="btn-icon" onClick={() => downloadBlob(currentHtmlUrl, `${label}.${isPng ? "png" : "html"}`)}>{isPng ? "PNG" : "HTML"}</button>}
          {isJson && current && <button className="btn-icon" onClick={() => downloadBlob(getPlotUrl(current.uri, current.version), `${label}.json`)}>JSON</button>}
        </div>
      </div>
      {!collapsed && plotContent}
    </div>
  );
}

interface PlotSideBySideProps {
  label: string;
  artifacts: PlotMember[];
  headless?: boolean;
  onActions?: (actions: PlotActions) => void;
}

export function PlotSideBySide({ label, artifacts, headless, onActions }: PlotSideBySideProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isJson = artifacts[0]?.artifact_type === "plotly_json";
  const isPng = artifacts[0]?.artifact_type === "png";
  const plots = artifacts.map((a) => usePlotHtml(isJson || isPng ? null : a.uri));

  const doDownloadAllHtml = () => {
    const ext = isPng ? "png" : "html";
    for (const a of artifacts) downloadBlob(memberHtmlUrl(a), `${label}_${a.label}.${ext}`);
  };
  const doDownloadAllJson = () => {
    for (const a of artifacts) downloadBlob(getPlotUrl(a.uri, a.version), `${label}_${a.label}.json`);
  };

  useEffect(() => {
    if (!onActions || artifacts.length === 0) return;
    const actions: PlotActions = {
      openUrls: artifacts.map((a) => ({ label: `Open ${a.label}`, url: memberHtmlUrl(a) })),
      download: doDownloadAllHtml,
    };
    if (isJson) actions.downloadJson = doDownloadAllJson;
    onActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  if (artifacts.length === 0) return null;
  if (artifacts.length === 1) {
    const a = artifacts[0];
    return <PlotArtifact uri={a.uri} html_uri={a.html_uri} label={a.label} artifact_type={a.artifact_type} headless={headless} onActions={onActions} />;
  }

  if (headless) {
    return (
      <div style={{ display: "flex", gap: "4px" }}>
        {artifacts.map((a, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ textAlign: "center", fontSize: "0.8rem", color: "#6b7280", padding: "0.25rem 0" }}>
              {a.label}
            </div>
            <MemberPlot member={a} htmlData={plots[i]?.html ?? null} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="plot-artifact">
      <div className="plot-header">
        <button className="plot-collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "+" : "-"}
        </button>
        <span className="plot-label">{label}</span>
        <div className="plot-actions">
          {artifacts.map((a, i) => (
            <a key={i} href={memberHtmlUrl(a)} target="_blank" rel="noopener noreferrer" className="btn-icon">
              Open {a.label}
            </a>
          ))}
          <button className="btn-icon" onClick={doDownloadAllHtml}>{isPng ? "All PNG" : "All HTML"}</button>
          {isJson && <button className="btn-icon" onClick={doDownloadAllJson}>All JSON</button>}
        </div>
      </div>
      {!collapsed && (
        <div style={{ display: "flex", gap: "4px" }}>
          {artifacts.map((a, i) => (
            <div key={i} style={{ flex: 1, minWidth: 0 }}>
              <div style={{ textAlign: "center", fontSize: "0.8rem", color: "#6b7280", padding: "0.25rem 0" }}>
                {a.label}
              </div>
              <MemberPlot member={a} htmlData={plots[i]?.html ?? null} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
