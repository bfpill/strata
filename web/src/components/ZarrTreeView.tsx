/**
 * Zarr DataTree viewer — renders consolidated metadata from zarr.json
 * in a layout matching xarray's HTML repr: tree of groups, each with
 * collapsible Dimensions / Coordinates / Data variables / Attributes sections.
 */
import { useState, useEffect, useId, useCallback } from "react";
import { FetchStore, open, get, root, slice } from "zarrita";
import "./ZarrTreeView.css";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://strata.timaeus-research-inc.workers.dev";

// --- Types for parsed consolidated metadata ---

interface ArrayMeta {
  node_type: "array";
  shape: number[];
  data_type: string | { name: string; configuration?: Record<string, any> };
  dimension_names?: string[];
  attributes?: Record<string, any>;
  chunk_grid?: { configuration?: { chunk_shape?: number[] } };
}

interface GroupNode {
  name: string;
  path: string;
  attrs: Record<string, any>;
  dims: Record<string, number>; // dim name → size (union of all arrays)
  coords: { name: string; meta: ArrayMeta }[];
  dataVars: { name: string; meta: ArrayMeta }[];
  children: GroupNode[];
}

// --- Parse consolidated metadata into tree ---

function parseConsolidated(
  metadata: Record<string, any>,
  rootAttrs: Record<string, any>,
): GroupNode {
  // Collect all groups and arrays
  const groups = new Map<string, { attrs: Record<string, any>; children: string[] }>();
  const arrays = new Map<string, { parent: string; name: string; meta: ArrayMeta }>();

  groups.set("/", { attrs: rootAttrs, children: [] });

  for (const [path, meta] of Object.entries(metadata)) {
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/") || "/";

    if (meta.node_type === "group") {
      groups.set(path, { attrs: meta.attributes ?? {}, children: [] });
      const parent = groups.get(parentPath);
      if (parent) parent.children.push(path);
    } else if (meta.node_type === "array") {
      arrays.set(path, { parent: parentPath === "" ? "/" : parentPath, name, meta });
    }
  }

  function buildGroup(path: string): GroupNode {
    const g = groups.get(path)!;
    const name = path === "/" ? "/" : path.split("/").pop()!;

    // Collect arrays belonging to this group
    const groupArrays: { name: string; meta: ArrayMeta }[] = [];
    for (const [, a] of arrays) {
      if (a.parent === path || (path === "/" && a.parent === "/")) {
        groupArrays.push({ name: a.name, meta: a.meta });
      }
    }

    // Determine dimensions: union of all array dimension_names + shapes
    const dims: Record<string, number> = {};
    for (const a of groupArrays) {
      if (a.meta.dimension_names) {
        a.meta.dimension_names.forEach((d, i) => {
          if (!(d in dims)) dims[d] = a.meta.shape[i];
        });
      }
    }

    // Separate coords (1D arrays whose name matches a dim) from data vars
    const dimSet = new Set(Object.keys(dims));
    const coords = groupArrays.filter(
      (a) => a.meta.dimension_names?.length === 1 && dimSet.has(a.name),
    );
    const coordNames = new Set(coords.map((c) => c.name));
    const dataVars = groupArrays.filter((a) => !coordNames.has(a.name));

    return {
      name,
      path,
      attrs: g.attrs,
      dims,
      coords,
      dataVars,
      children: (g.children || []).map(buildGroup),
    };
  }

  return buildGroup("/");
}

// --- Formatting helpers ---

function formatDtype(dt: string | { name: string; configuration?: Record<string, any> }): string {
  if (typeof dt === "string") return dt;
  if (dt.name === "fixed_length_utf32") {
    const len = (dt.configuration?.length_bytes ?? 0) / 4;
    return `<U${len}`;
  }
  return dt.name;
}

// --- Collapsible section (CSS-only, matching xarray pattern) ---

function CollapsibleSection({
  header,
  inlineDetail,
  children,
  nItems,
  defaultCollapsed = false,
  disabled = false,
}: {
  header: string;
  inlineDetail?: React.ReactNode;
  children?: React.ReactNode;
  nItems?: number;
  defaultCollapsed?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <li className="xr-section-item">
      <input
        id={id}
        className="xr-section-summary-in"
        type="checkbox"
        disabled={disabled || !nItems}
        defaultChecked={!defaultCollapsed && !!nItems}
      />
      <label htmlFor={id} className="xr-section-summary">
        {header}{nItems != null && <span> ({nItems})</span>}
      </label>
      <div className="xr-section-inline-details">{inlineDetail}</div>
      {children && <div className="xr-section-details">{children}</div>}
    </li>
  );
}

// --- Data preview fetching ---

const PREVIEW_MAX = 6; // max values to show at each end

/** Decode a fixed_length_utf32 array from raw (decompressed) bytes. */
function decodeFixedUtf32(buf: ArrayBuffer, numElements: number, bytesPerElement: number): string[] {
  const view = new DataView(buf);
  const strings: string[] = [];
  for (let i = 0; i < numElements; i++) {
    const offset = i * bytesPerElement;
    let s = "";
    for (let j = 0; j < bytesPerElement; j += 4) {
      const cp = view.getUint32(offset + j, true);
      if (cp === 0) break;
      s += String.fromCodePoint(cp);
    }
    strings.push(s);
  }
  return strings;
}

/** Fetch and decompress a zarr v3 chunk manually (for unsupported dtypes). */
async function fetchRawChunk(zarrUri: string): Promise<ArrayBuffer> {
  // Get codec chain from zarr.json
  const metaUrl = `${API_URL}/data/r2/${zarrUri}/zarr.json`;
  const metaResp = await fetch(metaUrl);
  const metaJson = await metaResp.json();
  const codecs = metaJson.codecs ?? [];

  // Fetch chunk c/0
  const chunkUrl = `${API_URL}/data/r2/${zarrUri}/c/0`;
  const chunkResp = await fetch(chunkUrl);
  let buf = await chunkResp.arrayBuffer();

  // Apply decompression codecs (skip "bytes" endian codec)
  for (const codec of codecs) {
    if (codec.name === "zstd") {
      const Zstd = (await import("numcodecs/zstd")).default;
      const zstd = Zstd.fromConfig(codec.configuration ?? {});
      const decoded = await zstd.decode(buf);
      buf = decoded instanceof ArrayBuffer ? decoded : decoded.buffer;
    }
    if (codec.name === "blosc") {
      const Blosc = (await import("numcodecs/blosc")).default;
      const blosc = Blosc.fromConfig(codec.configuration ?? {});
      const decoded = await blosc.decode(buf);
      buf = decoded instanceof ArrayBuffer ? decoded : decoded.buffer;
    }
    if (codec.name === "gzip") {
      const Gzip = (await import("numcodecs/gzip")).default;
      const gzip = Gzip.fromConfig(codec.configuration ?? {});
      const decoded = await gzip.decode(buf);
      buf = decoded instanceof ArrayBuffer ? decoded : decoded.buffer;
    }
  }
  return buf;
}

async function fetchArrayPreview(zarrUri: string, meta: ArrayMeta): Promise<string> {
  // Handle fixed_length_utf32 manually (zarrita doesn't support it)
  if (typeof meta.data_type === "object" && meta.data_type.name === "fixed_length_utf32") {
    const bytesPerElement = meta.data_type.configuration?.length_bytes ?? 0;
    const numElements = meta.shape.reduce((a, b) => a * b, 1);
    const buf = await fetchRawChunk(zarrUri);
    const strings = decodeFixedUtf32(buf, numElements, bytesPerElement);
    return strings.join("  ");
  }

  if (typeof meta.data_type === "object") {
    return `(preview not available for dtype ${meta.data_type.name})`;
  }

  const store = new FetchStore(`${API_URL}/data/r2/`);
  const arr = await open(root(store).resolve(zarrUri), { kind: "array" });
  const ndim = meta.shape.length;
  const totalSize = meta.shape.reduce((a, b) => a * b, 1);

  if (ndim === 1) {
    const n = meta.shape[0];
    if (n <= PREVIEW_MAX * 2 + 1) {
      // Small — load all
      const result = await get(arr, [null]);
      const vals = Array.from(result.data as Iterable<any>);
      return vals.join("  ");
    } else {
      // Large — load first and last
      const head = await get(arr, [slice(0, PREVIEW_MAX)]);
      const tail = await get(arr, [slice(n - PREVIEW_MAX, n)]);
      const headVals = Array.from(head.data as Iterable<any>);
      const tailVals = Array.from(tail.data as Iterable<any>);
      return headVals.join("  ") + "  ...  " + tailVals.join("  ");
    }
  }

  if (ndim === 2) {
    const [nRows, nCols] = meta.shape;
    const showRows = Math.min(nRows, PREVIEW_MAX);
    const showCols = Math.min(nCols, PREVIEW_MAX * 2);

    // Load a corner slice
    const chunk = await get(arr, [slice(0, showRows), slice(0, showCols)]);
    const data = chunk.data as any;
    const lines: string[] = [];

    for (let r = 0; r < showRows; r++) {
      const row: any[] = [];
      for (let c = 0; c < showCols; c++) {
        row.push(data[r * chunk.shape[1] + c]);
      }
      const rowStr = row.join("  ") + (nCols > showCols ? "  ..." : "");
      lines.push(rowStr);
    }
    if (nRows > showRows) {
      lines.push("...");
    }
    return lines.join("\n");
  }

  // Higher dims — just show shape
  return `${ndim}D array, total ${totalSize.toLocaleString()} elements`;
}

// --- Variable row ---

function VariableRow({
  name, meta, isCoord, zarrUri,
}: {
  name: string;
  meta: ArrayMeta;
  isCoord?: boolean;
  zarrUri: string; // full path to the array in R2
}) {
  const dims = meta.dimension_names ?? [];
  const dtype = formatDtype(meta.data_type);
  const shape = meta.shape;
  const dimsStr = `(${dims.join(", ")})`;
  const preview = shape.map((s) => s.toLocaleString()).join(" \u00d7 ");
  const attrs = meta.attributes ?? {};
  const hasAttrs = Object.keys(attrs).length > 0;
  const attrsId = useId();
  const dataId = useId();

  const [dataPreview, setDataPreview] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataChecked, setDataChecked] = useState(false);

  const handleDataToggle = useCallback(() => {
    const newChecked = !dataChecked;
    setDataChecked(newChecked);
    if (newChecked && dataPreview === null && !dataLoading) {
      setDataLoading(true);
      fetchArrayPreview(zarrUri, meta)
        .then((text) => setDataPreview(text))
        .catch((e) => setDataPreview(`Error: ${e}`))
        .finally(() => setDataLoading(false));
    }
  }, [dataChecked, dataPreview, dataLoading, zarrUri, meta]);

  return (
    <li className="xr-var-item">
      <div className="xr-var-name">
        <span className={isCoord ? "xr-has-index" : ""}>{name}</span>
      </div>
      <div className="xr-var-dims">{dimsStr}</div>
      <div className="xr-var-dtype">{dtype}</div>
      <div className="xr-var-preview xr-preview">{preview}</div>
      <input
        id={attrsId}
        className="xr-var-attrs-in"
        type="checkbox"
        disabled={!hasAttrs}
      />
      <label htmlFor={attrsId} title={hasAttrs ? "Show/Hide attributes" : undefined}>
        <svg className="icon xr-icon-file-text2"><use xlinkHref="#icon-file-text2" /></svg>
      </label>
      <input
        id={dataId}
        className="xr-var-data-in"
        type="checkbox"
        checked={dataChecked}
        onChange={handleDataToggle}
      />
      <label htmlFor={dataId} title="Show/Hide data preview">
        <svg className="icon xr-icon-database"><use xlinkHref="#icon-database" /></svg>
      </label>
      {hasAttrs && (
        <div className="xr-var-attrs">
          <dl className="xr-attrs">
            {Object.entries(attrs).map(([k, v]) => (
              <span key={k}>
                <dt><span>{k} :</span></dt>
                <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
              </span>
            ))}
          </dl>
        </div>
      )}
      <div className="xr-var-data">
        {dataChecked && (
          <pre className="xr-data-preview">
            {dataLoading ? "Loading..." : dataPreview ?? ""}
          </pre>
        )}
      </div>
    </li>
  );
}

// --- Dimensions inline ---

function DimsInline({ dims }: { dims: Record<string, number> }) {
  const entries = Object.entries(dims);
  if (entries.length === 0) return null;
  return (
    <ul className="xr-dim-list">
      {entries.map(([name, size]) => (
        <li key={name}>
          <span className="xr-has-index">{name}</span>: {size.toLocaleString()}
        </li>
      ))}
    </ul>
  );
}

// --- Attributes section ---

function AttrsDetail({ attrs }: { attrs: Record<string, any> }) {
  const json = JSON.stringify(attrs, null, 2);
  return (
    <pre className="xr-attr-json">{json}</pre>
  );
}

// --- Group node rendering ---

function GroupNodeView({ node, isRoot: _isRoot = false, baseZarrUri }: { node: GroupNode; isRoot?: boolean; baseZarrUri: string }) {
  const groupPrefix = node.path === "/" ? baseZarrUri : `${baseZarrUri}${node.path}/`;
  const hasDims = Object.keys(node.dims).length > 0;
  const hasCoords = node.coords.length > 0;
  const hasVars = node.dataVars.length > 0;
  const hasAttrs = Object.keys(node.attrs).length > 0;
  const hasContent = hasDims || hasCoords || hasVars || hasAttrs;

  return (
    <>
      {hasContent && (
        <ul className="xr-sections">
          {node.children.length > 0 && (
            <li className="xr-section-item">
              <div className="xr-children">
                {node.children.map((child, i) => (
                  <ChildGroupView
                    key={child.path}
                    node={child}
                    isLast={i === node.children.length - 1}
                    baseZarrUri={baseZarrUri}
                  />
                ))}
              </div>
            </li>
          )}
          {hasDims && (
            <CollapsibleSection
              header="Dimensions:"
              inlineDetail={<DimsInline dims={node.dims} />}
              disabled
              defaultCollapsed
            />
          )}
          {hasCoords && (
            <CollapsibleSection
              header="Coordinates:"
              nItems={node.coords.length}
            >
              <ul className="xr-var-list">
                {node.coords.map((c) => (
                  <VariableRow key={c.name} name={c.name} meta={c.meta} isCoord zarrUri={`${groupPrefix}${c.name}`} />
                ))}
              </ul>
            </CollapsibleSection>
          )}
          {hasVars && (
            <CollapsibleSection
              header="Data variables:"
              nItems={node.dataVars.length}
            >
              <ul className="xr-var-list">
                {node.dataVars.map((v) => (
                  <VariableRow key={v.name} name={v.name} meta={v.meta} zarrUri={`${groupPrefix}${v.name}`} />
                ))}
              </ul>
            </CollapsibleSection>
          )}
          {hasAttrs && (
            <CollapsibleSection
              header="Attributes:"
              nItems={Object.keys(node.attrs).length}
              defaultCollapsed
            >
              <AttrsDetail attrs={node.attrs} />
            </CollapsibleSection>
          )}
        </ul>
      )}
      {!hasContent && node.children.length > 0 && (
        <div className="xr-children">
          {node.children.map((child, i) => (
            <ChildGroupView
              key={child.path}
              node={child}
              isLast={i === node.children.length - 1}
              baseZarrUri={baseZarrUri}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ChildGroupView({ node, isLast, baseZarrUri }: { node: GroupNode; isLast: boolean; baseZarrUri: string }) {
  const id = useId();
  const itemCount =
    node.coords.length + node.dataVars.length + Object.keys(node.attrs).length +
    node.children.reduce((s, c) => s + c.coords.length + c.dataVars.length, 0);

  return (
    <div className="xr-group-box">
      <div
        className="xr-group-box-vline"
        style={{ height: isLast ? "1.2em" : "100%" }}
      />
      <div className="xr-group-box-hline" />
      <div className="xr-group-box-contents">
        <input id={id} type="checkbox" defaultChecked />
        <label htmlFor={id} title="Expand/collapse group">
          {node.path}
          <span> ({itemCount})</span>
        </label>
        <GroupNodeView node={node} baseZarrUri={baseZarrUri} />
      </div>
    </div>
  );
}

// --- Main component ---

export interface ZarrTreeViewProps {
  zarrUri: string;
}

export function ZarrTreeView({ zarrUri }: ZarrTreeViewProps) {
  const [tree, setTree] = useState<GroupNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_URL}/data/r2/${zarrUri}zarr.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const consolidated = json.consolidated_metadata?.metadata ?? {};
        const rootAttrs = json.attributes ?? {};
        setTree(parseConsolidated(consolidated, rootAttrs));
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [zarrUri]);

  if (loading) return <div style={{ padding: "2rem", color: "#6b7280" }}>Loading zarr metadata...</div>;
  if (error) return <div style={{ padding: "2rem", color: "#dc2626" }}>Error: {error}</div>;
  if (!tree) return null;

  return (
    <div className="zarr-tree-view">
      <svg style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
        <defs>
          <symbol id="icon-database" viewBox="0 0 32 32">
            <path d="M16 0c-8.837 0-16 2.239-16 5v4c0 2.761 7.163 5 16 5s16-2.239 16-5v-4c0-2.761-7.163-5-16-5z" />
            <path d="M16 17c-8.837 0-16-2.239-16-5v6c0 2.761 7.163 5 16 5s16-2.239 16-5v-6c0 2.761-7.163 5-16 5z" />
            <path d="M16 26c-8.837 0-16-2.239-16-5v6c0 2.761 7.163 5 16 5s16-2.239 16-5v-6c0 2.761-7.163 5-16 5z" />
          </symbol>
          <symbol id="icon-file-text2" viewBox="0 0 32 32">
            <path d="M28.681 7.159c-0.694-0.947-1.662-2.053-2.724-3.116s-2.169-2.030-3.116-2.724c-1.612-1.182-2.393-1.319-2.841-1.319h-15.5c-1.378 0-2.5 1.121-2.5 2.5v27c0 1.378 1.122 2.5 2.5 2.5h23c1.378 0 2.5-1.122 2.5-2.5v-19.5c0-0.448-0.137-1.23-1.319-2.841zM24.543 5.457c0.959 0.959 1.712 1.825 2.268 2.543h-4.811v-4.811c0.718 0.556 1.584 1.309 2.543 2.268zM28 29.5c0 0.271-0.229 0.5-0.5 0.5h-23c-0.271 0-0.5-0.229-0.5-0.5v-27c0-0.271 0.229-0.5 0.5-0.5 0 0 15.499-0 15.5 0v7c0 0.552 0.448 1 1 1h7v19.5z" />
            <path d="M23 26h-14c-0.552 0-1-0.448-1-1s0.448-1 1-1h14c0.552 0 1 0.448 1 1s-0.448 1-1 1z" />
            <path d="M23 22h-14c-0.552 0-1-0.448-1-1s0.448-1 1-1h14c0.552 0 1 0.448 1 1s-0.448 1-1 1z" />
            <path d="M23 18h-14c-0.552 0-1-0.448-1-1s0.448-1 1-1h14c0.552 0 1 0.448 1 1s-0.448 1-1 1z" />
          </symbol>
        </defs>
      </svg>
      <div className="xr-wrap">
        <div className="xr-header">
          <div className="xr-obj-type">zarr.DataTree</div>
        </div>
        <GroupNodeView node={tree} isRoot baseZarrUri={zarrUri} />
      </div>
    </div>
  );
}
