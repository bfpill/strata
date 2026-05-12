import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FetchStore, open, get, root } from "zarrita";

// Use v3 directly to avoid 404 probes for .zattrs/.zgroup (zarr v2)
const openV3 = open.v3;
import { SimulatorPane } from "./SimulatorPane";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://strata.timaeus-research-inc.workers.dev";

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

interface Code {
  writes: number[];
  states: number[];
  moves: number[];
}

interface ArrayMeta {
  dimension_names: string[];
  shape: number[];
  dtype: string;
}

export interface CodeBrowserData {
  model: Model;
  task: Task;
  zarr_uri: string;
  arrays?: Record<string, ArrayMeta>;
}

export interface CodeBrowserPaneProps {
  data: CodeBrowserData;
  /** Extra controls rendered inside the sticky header (e.g. variant selector) */
  headerControls?: React.ReactNode;
}

/** Extra array info discovered from arrays metadata. */
interface ExtraArraySpec {
  name: string;
  dims: string[];
  dtype: string;
}

interface ZarrArrays {
  writes: any;
  states: any;
  moves: any;
  tmCoords: number[] | null;  // eagerly loaded for small datasets
  tmArr: any | null;          // zarr array ref for on-demand reads (large datasets)
  numCodes: number;
  extras: { spec: ExtraArraySpec; arr: any }[];
}

/** Values for extra arrays at a given tm index. */
interface ExtraValues {
  [name: string]: { spec: ExtraArraySpec; value: any };
}

const CORE_ARRAYS = new Set(["writes", "states", "moves", "tm", "transition"]);

function discoverExtras(arrays?: Record<string, ArrayMeta>): ExtraArraySpec[] {
  if (!arrays) return [];
  const extras: ExtraArraySpec[] = [];
  for (const [name, meta] of Object.entries(arrays)) {
    if (CORE_ARRAYS.has(name)) continue;
    if (!meta.dimension_names.includes("tm")) continue;
    extras.push({ name, dims: meta.dimension_names, dtype: meta.dtype });
  }
  return extras;
}

async function openZarrArrays(
  zarrUri: string,
  extraSpecs: ExtraArraySpec[],
): Promise<ZarrArrays> {
  const store = new FetchStore(`${API_URL}/data/r2/`);
  const loc = root(store).resolve(zarrUri);
  const grp = await openV3(loc, { kind: "group" });
  const writes = await openV3(grp.resolve("writes"), { kind: "array" });
  const states = await openV3(grp.resolve("states"), { kind: "array" });
  const moves = await openV3(grp.resolve("moves"), { kind: "array" });
  const numCodes = writes.shape[0];

  // For small datasets, load all tm coords eagerly (enables typed lookup).
  // For large datasets, keep a zarr array ref for on-demand single-value reads.
  const TM_COORD_MAX = 100_000;
  let tmCoords: number[] | null = null;
  let tmArr: any | null = null;
  try {
    tmArr = await openV3(grp.resolve("tm"), { kind: "array" });
    if (numCodes <= TM_COORD_MAX) {
      const tmData = await get(tmArr, [null]);
      tmCoords = Array.from(tmData.data as Iterable<number>);
    }
  } catch {
    // No tm coord array — default to 0..N-1
  }

  const extras: { spec: ExtraArraySpec; arr: any }[] = [];
  for (const spec of extraSpecs) {
    try {
      const arr = await openV3(grp.resolve(spec.name), { kind: "array" });
      extras.push({ spec, arr });
    } catch {
      // Array not available in this zarr group, skip
    }
  }

  return { writes, states, moves, tmCoords, tmArr, numCodes, extras };
}

async function readCode(arrays: ZarrArrays, index: number): Promise<Code> {
  const [w, s, m] = await Promise.all([
    get(arrays.writes, [index, null]),
    get(arrays.states, [index, null]),
    get(arrays.moves, [index, null]),
  ]);
  return {
    writes: Array.from(w.data as Iterable<number>),
    states: Array.from(s.data as Iterable<number>),
    moves: Array.from(m.data as Iterable<number>),
  };
}

async function readExtras(
  arrays: ZarrArrays,
  index: number,
): Promise<ExtraValues> {
  const result: ExtraValues = {};
  for (const { spec, arr } of arrays.extras) {
    try {
      if (spec.dims.length === 1) {
        // Scalar per tm (e.g. num_used)
        const chunk = await get(arr, [index]);
        result[spec.name] = { spec, value: chunk };
      } else if (spec.dims.length === 2) {
        // Vector per tm (e.g. used: [tm, transition])
        const chunk = await get(arr, [index, null]);
        result[spec.name] = {
          spec,
          value: Array.from(chunk.data as Iterable<number>),
        };
      }
    } catch {
      // Skip failed reads
    }
  }
  return result;
}

function fmtValue(v: any): string {
  if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(5);
  return String(v);
}

function formatExtraValue(
  name: string,
  spec: ExtraArraySpec,
  value: any,
): React.ReactNode {
  if (spec.dims.length === 1) {
    return (
      <span className="code-browser-extra-scalar">
        {name}: <strong>{fmtValue(value)}</strong>
      </span>
    );
  }
  if (spec.dims.length === 2 && Array.isArray(value)) {
    return (
      <span className="code-browser-extra-vector">
        {name}: [{value.map(fmtValue).join(", ")}]
      </span>
    );
  }
  return (
    <span className="code-browser-extra-scalar">
      {name}: {JSON.stringify(value)}
    </span>
  );
}

export function CodeBrowserPane({ data, headerControls }: CodeBrowserPaneProps) {
  const [arrays, setArrays] = useState<ZarrArrays | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [extraValues, setExtraValues] = useState<ExtraValues>({});
  const [tmVal, setTmVal] = useState<number>(0);
  const [codeIndex, setCodeIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingCode, setLoadingCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tmInput, setTmInput] = useState("0");
  const codeCache = useRef(new Map<number, { code: Code; extras: ExtraValues; tmVal: number }>());

  const extraSpecs = useMemo(() => discoverExtras(data.arrays), [data.arrays]);

  // Build coord → index lookup for typed tm coordinate input
  const tmToIndex = useMemo(() => {
    if (!arrays?.tmCoords) return null;
    const map = new Map<number, number>();
    arrays.tmCoords.forEach((v, i) => map.set(v, i));
    return map;
  }, [arrays]);

  // Open zarr arrays on mount / zarr_uri change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    openZarrArrays(data.zarr_uri, extraSpecs)
      .then((a) => {
        if (!cancelled) {
          codeCache.current = new Map();
          setArrays(a);
          setCodeIndex(0);
          // tmInput will be set by the code loading effect
        }
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [data.zarr_uri, extraSpecs]);

  // Load code + extras + tmVal when index changes (cached)
  useEffect(() => {
    if (!arrays) return;
    if (codeIndex < 0 || codeIndex >= arrays.numCodes) return;
    const cached = codeCache.current.get(codeIndex);
    if (cached) {
      setCode(cached.code);
      setExtraValues(cached.extras);
      setTmVal(cached.tmVal);
      setTmInput(String(cached.tmVal));
      return;
    }
    let cancelled = false;
    setLoadingCode(true);

    // Resolve tm coordinate value
    const tmPromise: Promise<number> = arrays.tmCoords
      ? Promise.resolve(arrays.tmCoords[codeIndex])
      : arrays.tmArr
        ? get(arrays.tmArr, [codeIndex]).then((v: any) => Number(v))
        : Promise.resolve(codeIndex);

    Promise.all([readCode(arrays, codeIndex), readExtras(arrays, codeIndex), tmPromise])
      .then(([c, ev, tv]) => {
        if (!cancelled) {
          codeCache.current.set(codeIndex, { code: c, extras: ev, tmVal: tv });
          setCode(c);
          setExtraValues(ev);
          setTmVal(tv);
          setTmInput(String(tv));
        }
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoadingCode(false); });
    return () => { cancelled = true; };
  }, [arrays, codeIndex]);

  const goToIndex = useCallback((idx: number) => {
    if (!arrays) return;
    setCodeIndex(Math.max(0, Math.min(arrays.numCodes - 1, idx)));
  }, [arrays]);

  const handleTmSubmit = useCallback(() => {
    if (!arrays) return;
    const val = parseInt(tmInput);
    if (isNaN(val)) return;

    if (tmToIndex) {
      // Has tm coordinates — look up by coordinate value
      const idx = tmToIndex.get(val);
      if (idx !== undefined) goToIndex(idx);
    } else {
      // No coords — input is the index directly
      goToIndex(val);
    }
  }, [arrays, tmInput, tmToIndex, goToIndex]);

  if (loading) {
    return <div style={{ padding: "2rem", color: "#6b7280" }}>Loading zarr store...</div>;
  }
  if (error) {
    return <div style={{ padding: "2rem", color: "#dc2626" }}>Error: {error}</div>;
  }
  if (!arrays || !code) {
    return <div style={{ padding: "2rem", color: "#6b7280" }}>No data.</div>;
  }

  const codeLabel = `tm ${tmVal}`;
  const codes: Record<string, Code> = { [codeLabel]: code };

  const extraEntries = Object.entries(extraValues);

  return (
    <div className="code-browser-pane">
      <div className="code-browser-header">
        {headerControls}
        <div className="code-browser-bar">
          <div className="code-browser-nav">
            <button
              className="code-browser-btn"
              onClick={() => goToIndex(codeIndex - 1)}
              disabled={codeIndex <= 0}
              title="Previous"
            >
              ‹
            </button>

            <div className="code-browser-index">
              <span className="code-browser-label">tm</span>
              <input
                className="code-browser-tm-input"
                type="text"
                value={tmInput}
                onChange={(e) => setTmInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleTmSubmit(); }}
                onBlur={handleTmSubmit}
              />
            </div>

            <button
              className="code-browser-btn"
              onClick={() => goToIndex(codeIndex + 1)}
              disabled={codeIndex >= arrays.numCodes - 1}
              title="Next"
            >
              ›
            </button>

            <span className="code-browser-meta">
              {(codeIndex + 1).toLocaleString()} of {arrays.numCodes.toLocaleString()}
            </span>

            {loadingCode && <span className="code-browser-loading">loading...</span>}
          </div>

          <input
            className="code-browser-slider"
            type="range"
            min={0}
            max={arrays.numCodes - 1}
            value={codeIndex}
            onChange={(e) => goToIndex(parseInt(e.target.value))}
          />
        </div>

        {extraEntries.length > 0 && (
          <div className="code-browser-extras">
            {extraEntries.map(([name, { spec, value }]) => (
              <div key={name} className="code-browser-extra-item">
                {formatExtraValue(name, spec, value)}
              </div>
            ))}
          </div>
        )}
      </div>

      <SimulatorPane
        model={data.model}
        task={data.task}
        codes={codes}
        hideCodeSelector
      />
    </div>
  );
}
