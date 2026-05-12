import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { FetchStore, open, get, root, slice } from "zarrita";
import Plot from "../plotly";
import {
  NoisyTMSimplex,
  TMTrajectory,
  CellDetailPanel,
  type TMModelConfig,
  type NoisyTMCode,
  type NoisyTMHistory,
  type TMTrajectoryModel,
  type TrajectoryCellId,
  type Model,
  type Code,
  runNoisyTMHistory,
  prepareNoisyRun,
  oneHot,
} from "@noisy-tm/ui";
import "@noisy-tm/ui/src/TMTrajectory.css";
import "@noisy-tm/ui/src/InteractiveNoisyTM.css";
import "@noisy-tm/ui/src/styles.css";
import "./SimplexExplorerPane.css";

const openV3 = open.v3;

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://strata.timaeus-research-inc.workers.dev";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskData {
  inputs: string[];
  outputs: string[];
  dist: number[];
  tm_steps: number;
}

interface ModelData {
  alphabet: string[];
  states: string[];
  dirs: string[];
  transition_pairs: [string, string][];
  skip_staging?: boolean;
}

interface CodeData {
  writes: number[];
  states: number[];
  moves: number[];
}

export interface SimplexExplorerData {
  model: ModelData;
  task: TaskData;
  code: CodeData;
  zarr_uri: string;
  wr_labels: string[];
  num_chains: number;
  num_steps: number;
}

export interface SimplexExplorerPaneProps {
  data: SimplexExplorerData;
}

// ---------------------------------------------------------------------------
// Zarr helpers
// ---------------------------------------------------------------------------

function zarrStore() {
  return new FetchStore(`${API_URL}/data/r2/`);
}

/** Load a single chain's pi trajectory for a given scope.
 *
 * For "full" (wrIdx === null): loads /full/pi_{axis}[chain, :, :, :]
 *   → Float32Array with shape [steps, transitions, K]
 *
 * For a WR (wrIdx is number): loads /wrs/pi_{axis}[wrIdx, chain, :, :, :]
 *   → Float32Array with shape [steps, transitions, K]
 */
async function loadPiAxis(
  zarrUri: string,
  scope: "full" | "wrs",
  axis: "writes" | "states" | "moves",
  chain: number,
  wrIdx: number | null,
): Promise<{ data: Float32Array; shape: number[] }> {
  const store = zarrStore();
  const loc = root(store).resolve(`${zarrUri}/${scope}/pi/${axis}`);
  const arr = await openV3(loc, { kind: "array" });

  let result: any;
  if (scope === "full") {
    // shape: [chains, steps, trans, K]
    result = await get(arr, [chain, null, null, null]);
  } else {
    // shape: [wrs, chains, steps, trans, K]
    result = await get(arr, [wrIdx!, chain, null, null, null]);
  }
  return { data: result.data as Float32Array, shape: result.shape as number[] };
}

/** Load loss trajectory for a chain.
 *  full: /full/loss[chain, :] → [steps]
 *  wrs: /wrs/loss[wrIdx, chain, :] → [steps]
 */
async function loadLoss(
  zarrUri: string,
  scope: "full" | "wrs",
  chain: number,
  wrIdx: number | null,
): Promise<Float32Array> {
  const store = zarrStore();
  const loc = root(store).resolve(`${zarrUri}/${scope}/loss`);
  const arr = await openV3(loc, { kind: "array" });

  let result: any;
  if (scope === "full") {
    result = await get(arr, [chain, null]);
  } else {
    result = await get(arr, [wrIdx!, chain, null]);
  }
  return result.data as Float32Array;
}

/** Load per-input loss trajectory.
 *  full: /full/ps_loss[chain, :, :] → [steps, inputs]
 *  wrs: /wrs/ps_loss[wrIdx, chain, :, :] → [steps, inputs]
 */
async function loadPsLoss(
  zarrUri: string,
  scope: "full" | "wrs",
  chain: number,
  wrIdx: number | null,
): Promise<{ data: Float32Array; shape: number[] }> {
  const store = zarrStore();
  const loc = root(store).resolve(`${zarrUri}/${scope}/ps_loss`);
  const arr = await openV3(loc, { kind: "array" });

  let result: any;
  if (scope === "full") {
    result = await get(arr, [chain, null, null]);
  } else {
    result = await get(arr, [wrIdx!, chain, null, null]);
  }
  return { data: result.data as Float32Array, shape: result.shape as number[] };
}

/** Load chain_valid array.
 *  full: /full/chain_valid[:] → [chains]
 *  wrs: /wrs/chain_valid[wrIdx, :] → [chains]
 */
async function loadChainValid(
  zarrUri: string,
  scope: "full" | "wrs",
  wrIdx: number | null,
): Promise<boolean[]> {
  const store = zarrStore();
  const loc = root(store).resolve(`${zarrUri}/${scope}/chain_valid`);
  const arr = await openV3(loc, { kind: "array" });

  let result: any;
  if (scope === "full") {
    result = await get(arr, null);
  } else {
    result = await get(arr, [wrIdx!, null]);
  }
  // chain_valid is stored as bool or uint8
  const raw = result.data;
  return Array.from(raw as ArrayLike<number>, (v) => Boolean(v));
}

// ---------------------------------------------------------------------------
// Data reshaping
// ---------------------------------------------------------------------------

/** Reshape flat Float32Array [steps, transitions, K] into per-transition trajectories.
 *  Returns: trajectories[transition][step] = number[] of length K
 */
function reshapePi(
  data: Float32Array,
  shape: number[],
): number[][][] {
  const [steps, transitions, K] = shape;
  const result: number[][][] = [];
  for (let t = 0; t < transitions; t++) {
    const traj: number[][] = [];
    for (let s = 0; s < steps; s++) {
      const row: number[] = [];
      for (let k = 0; k < K; k++) {
        row.push(data[(s * transitions + t) * K + k]);
      }
      traj.push(row);
    }
    result.push(traj);
  }
  return result;
}

/** Try loading a pytree quantity subgroup axis; returns null if not found. */
async function tryLoadPiAxis(
  zarrUri: string,
  scope: "full" | "wrs",
  subgroup: string,
  axis: "writes" | "states" | "moves",
  chain: number,
  wrIdx: number | null,
): Promise<{ data: Float32Array; shape: number[] } | null> {
  try {
    const store = zarrStore();
    const loc = root(store).resolve(`${zarrUri}/${scope}/${subgroup}/${axis}`);
    const arr = await openV3(loc, { kind: "array" });
    let result: any;
    if (scope === "full") {
      result = await get(arr, [chain, null, null, null]);
    } else {
      result = await get(arr, [wrIdx!, chain, null, null, null]);
    }
    return { data: result.data as Float32Array, shape: result.shape as number[] };
  } catch {
    return null;
  }
}

/** Subsample trajectory to at most maxPoints steps for rendering performance. */
function subsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = (arr.length - 1) / (maxPoints - 1);
  const result: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(arr[Math.round(i * step)]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// TrajectoryData: loaded + cached per (wrIdx, chain)
// ---------------------------------------------------------------------------

interface TrajectoryData {
  /** Per-transition trajectories: [transition][step][K] */
  piWrites: number[][][];
  piStates: number[][][];
  piMoves: number[][][];
  /** Per-transition data_drift trajectories (optional): [transition][step][K] */
  ddWrites: number[][][] | null;
  ddStates: number[][][] | null;
  ddMoves: number[][][] | null;
  /** Total loss per step: [steps] */
  loss: Float32Array;
  /** Per-input loss: [steps][inputs] */
  psLoss: Float32Array;
  psLossShape: number[];
  numSteps: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MAX_SIMPLEX_POINTS = 500;

export function SimplexExplorerPane({ data }: SimplexExplorerPaneProps) {
  const { model, task, code, wr_labels, num_chains } = data;
  // Strip trailing slash to avoid double-slash in zarr paths
  const zarr_uri = data.zarr_uri.replace(/\/+$/, "");

  // --- Controls state ---
  const wrOptions = useMemo(() => ["full", ...wr_labels], [wr_labels]);
  const [selectedWr, setSelectedWr] = useState("full");
  const [selectedChain, setSelectedChain] = useState(0);
  const [selectedInput, setSelectedInput] = useState(task.inputs[0] ?? "");
  const [step, setStep] = useState(0);
  const [renderMode, setRenderMode] = useState<"heatmap" | "path">("heatmap");

  // --- Loading state ---
  const [trajData, setTrajData] = useState<TrajectoryData | null>(null);
  const [chainValid, setChainValid] = useState<boolean[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cache: key → TrajectoryData
  const cacheRef = useRef<Map<string, TrajectoryData>>(new Map());
  const chainValidCacheRef = useRef<Map<string, boolean[]>>(new Map());

  const scope: "full" | "wrs" = selectedWr === "full" ? "full" : "wrs";
  const wrIdx = selectedWr === "full" ? null : wr_labels.indexOf(selectedWr);

  // --- Load data when WR/chain changes ---
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${selectedWr}:${selectedChain}`;
    const validCacheKey = selectedWr;

    // Check cache
    const cached = cacheRef.current.get(cacheKey);
    const cachedValid = chainValidCacheRef.current.get(validCacheKey);
    if (cached && cachedValid) {
      setTrajData(cached);
      setChainValid(cachedValid);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [writes, states, moves, loss, psLoss, valid] = await Promise.all([
          loadPiAxis(zarr_uri, scope, "writes", selectedChain, wrIdx),
          loadPiAxis(zarr_uri, scope, "states", selectedChain, wrIdx),
          loadPiAxis(zarr_uri, scope, "moves", selectedChain, wrIdx),
          loadLoss(zarr_uri, scope, selectedChain, wrIdx),
          loadPsLoss(zarr_uri, scope, selectedChain, wrIdx),
          cachedValid ? Promise.resolve(cachedValid) : loadChainValid(zarr_uri, scope, wrIdx),
        ]);

        if (cancelled) return;

        // Try loading data_drift (optional — older experiments may not have the subgroup)
        const [ddW, ddS, ddM] = await Promise.all([
          tryLoadPiAxis(zarr_uri, scope, "data_drift", "writes", selectedChain, wrIdx),
          tryLoadPiAxis(zarr_uri, scope, "data_drift", "states", selectedChain, wrIdx),
          tryLoadPiAxis(zarr_uri, scope, "data_drift", "moves", selectedChain, wrIdx),
        ]);

        if (cancelled) return;

        const td: TrajectoryData = {
          piWrites: reshapePi(writes.data, writes.shape),
          piStates: reshapePi(states.data, states.shape),
          piMoves: reshapePi(moves.data, moves.shape),
          ddWrites: ddW ? reshapePi(ddW.data, ddW.shape) : null,
          ddStates: ddS ? reshapePi(ddS.data, ddS.shape) : null,
          ddMoves: ddM ? reshapePi(ddM.data, ddM.shape) : null,
          loss,
          psLoss: psLoss.data,
          psLossShape: psLoss.shape,
          numSteps: writes.shape[0],
        };

        const validArr = Array.isArray(valid) ? valid : valid as boolean[];

        cacheRef.current.set(cacheKey, td);
        if (!cachedValid) {
          chainValidCacheRef.current.set(validCacheKey, validArr);
        }

        setTrajData(td);
        setChainValid(validArr);
        setStep((prev) => Math.min(prev, td.numSteps - 1));
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedWr, selectedChain, zarr_uri, scope, wrIdx]);

  // --- Build simplex code (trajectory format) ---
  const simplexCode: Code<number[] | number[][]> | null = useMemo(() => {
    if (!trajData) return null;
    return {
      writes: trajData.piWrites.map((t) => subsample(t, MAX_SIMPLEX_POINTS)),
      states: trajData.piStates.map((t) => subsample(t, MAX_SIMPLEX_POINTS)),
      moves: trajData.piMoves.map((t) => subsample(t, MAX_SIMPLEX_POINTS)),
    };
  }, [trajData]);

  // Map step index to subsampled step index
  const simplexStep = useMemo(() => {
    if (!trajData) return 0;
    const total = trajData.numSteps;
    const nPts = Math.min(total, MAX_SIMPLEX_POINTS);
    if (nPts >= total) return step;
    return Math.round((step / (total - 1)) * (nPts - 1));
  }, [trajData, step]);

  // --- Build tangent (data_drift) at current step ---
  const tangentAtStep: Code<number[] | null> | null = useMemo(() => {
    if (!trajData || !trajData.ddWrites) return null;
    const { ddWrites, ddStates, ddMoves } = trajData;
    return {
      writes: ddWrites!.map((t) => t[step] ?? null),
      states: ddStates!.map((t) => t[step] ?? null),
      moves: ddMoves!.map((t) => t[step] ?? null),
    };
  }, [trajData, step]);

  // --- Build model for UI components ---
  const uiModel: Model = useMemo(() => ({
    alphabet: model.alphabet,
    states: model.states,
    dirs: model.dirs as ("L" | "S" | "R")[],
    transition_pairs: model.transition_pairs,
  }), [model]);

  const modelConfig: TMModelConfig = useMemo(() => ({
    alphabet: model.alphabet,
    states: model.states,
    dirs: model.dirs as ("L" | "S" | "R")[],
    transition_pairs: model.transition_pairs,
    skip_staging: model.skip_staging,
  }), [model]);

  // --- Build NoisyTMCode at selected step and run simulation ---
  const tmHistory: NoisyTMHistory | null = useMemo(() => {
    if (!trajData || !selectedInput) return null;
    try {
      const codeAtStep: NoisyTMCode = {
        writes: trajData.piWrites.map((t) => t[step]),
        states: trajData.piStates.map((t) => t[step]),
        moves: trajData.piMoves.map((t) => t[step]),
      };
      const { initialTape, initialState, headZero } = prepareNoisyRun(
        modelConfig, selectedInput, task.tm_steps,
      );
      return runNoisyTMHistory(
        codeAtStep, task.tm_steps, modelConfig,
        headZero, initialTape, initialState,
      );
    } catch {
      return null;
    }
  }, [trajData, step, selectedInput, modelConfig, task.tm_steps]);

  // --- Loss chart data ---
  const lossChartData = useMemo(() => {
    if (!trajData) return null;
    const steps = Array.from({ length: trajData.numSteps }, (_, i) => i);
    const lossArr = Array.from(trajData.loss);

    // Per-input loss at each step for selected input
    const inputIdx = task.inputs.indexOf(selectedInput);
    let psLossArr: number[] | null = null;
    if (inputIdx >= 0 && trajData.psLossShape.length === 2) {
      const [nSteps, nInputs] = trajData.psLossShape;
      psLossArr = [];
      for (let s = 0; s < nSteps; s++) {
        psLossArr.push(trajData.psLoss[s * nInputs + inputIdx]);
      }
    }

    return { steps, loss: lossArr, psLoss: psLossArr, inputIdx };
  }, [trajData, selectedInput, task.inputs]);

  // --- Global ps_loss range (stable across steps) ---
  const psLossRange = useMemo((): [number, number] | null => {
    if (!trajData) return null;
    const arr = trajData.psLoss;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!isFinite(lo)) return [0, 1];
    const pad = (hi - lo) * 0.05 || 0.1;
    return [Math.min(0, lo - pad), hi + pad];
  }, [trajData]);

  // --- Per-input loss bar at current step ---
  const barData = useMemo(() => {
    if (!trajData) return null;
    const [nSteps, nInputs] = trajData.psLossShape;
    if (nSteps === 0 || nInputs === 0) return null;

    const losses: number[] = [];
    const offset = step * nInputs;
    for (let i = 0; i < nInputs; i++) {
      losses.push(trajData.psLoss[offset + i]);
    }

    const palette = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d"];
    const uniqueOutputs = [...new Set(task.outputs)];
    const colorMap: Record<string, string> = {};
    uniqueOutputs.forEach((o, i) => { colorMap[o] = palette[i % palette.length]; });
    const colors = task.outputs.map((o) => colorMap[o]);
    const borderColors = task.inputs.map((inp) => inp === selectedInput ? "#000000" : "rgba(0,0,0,0)");

    const totalLoss = trajData.loss[step];

    return { losses, colors, borderColors, totalLoss };
  }, [trajData, step, task, selectedInput]);

  // --- Event handlers ---
  const handleWrChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedWr(e.target.value);
  }, []);

  const handleChainChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedChain(Number(e.target.value));
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedInput(e.target.value);
  }, []);

  const handleStepChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setStep(Number(e.target.value));
  }, []);

  const numSteps = trajData?.numSteps ?? data.num_steps;

  // --- Trajectory hover/pin (simulator pattern) ---
  const [pinnedCell, setPinnedCell] = useState<TrajectoryCellId | null>(null);
  const [hoveredCell, setHoveredCell] = useState<TrajectoryCellId | null>(null);
  const detailPortalRef = useRef<HTMLDivElement>(null);

  const activeCell = hoveredCell ?? pinnedCell;

  const activeCellData = useMemo(() => {
    if (!activeCell || !tmHistory) return null;
    const { section, timestep: t, column } = activeCell;
    let probs: number[] | undefined;
    let labels: string[] = [];
    let type: "symbol" | "state" | "dir" | "other" = "other";
    if (section === "tape" && column != null) {
      probs = (tmHistory.tape[t] as number[][])?.[column];
      labels = model.alphabet;
      type = "symbol";
    } else if (section === "state") {
      probs = tmHistory.state[t] as number[];
      labels = model.states;
      type = "state";
    } else if (section === "transition") {
      if (column === 0) { probs = tmHistory.write[t] as number[]; labels = model.alphabet; type = "symbol"; }
      else if (column === 1) { probs = tmHistory.next_state[t] as number[]; labels = model.states; type = "state"; }
      else if (column === 2) { probs = tmHistory.move[t] as number[]; labels = model.dirs as string[]; type = "dir"; }
    }
    if (!probs) return null;
    return { probs, labels, type };
  }, [activeCell, tmHistory, model]);

  const finalStateProbs = useMemo(() => {
    if (!tmHistory) return null;
    return tmHistory.state[task.tm_steps] as number[];
  }, [tmHistory, task.tm_steps]);

  const trajectoryModel: TMTrajectoryModel = useMemo(() => ({
    alphabet: model.alphabet,
    states: model.states,
    dirs: model.dirs as string[],
  }), [model]);

  // --- Resizable charts panel ---
  const [chartsWidth, setChartsWidth] = useState(400);
  const draggingRef = useRef(false);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startWidth = chartsWidth;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startX - ev.clientX;
      setChartsWidth(Math.max(200, startWidth + delta));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [chartsWidth]);

  // Chain validity indicator
  const chainIsValid = chainValid ? chainValid[selectedChain] : true;

  const showingActiveCell = !!(activeCell && activeCellData);

  return (
    <div className="simplex-explorer">
      {/* Controls bar */}
      <div className="simplex-explorer-controls">
        <div className="simplex-explorer-control-group">
          <label>WR</label>
          <select value={selectedWr} onChange={handleWrChange}>
            {wrOptions.map((wr) => (
              <option key={wr} value={wr}>{wr}</option>
            ))}
          </select>
        </div>

        <div className="simplex-explorer-control-group">
          <label>Chain</label>
          <select value={selectedChain} onChange={handleChainChange}>
            {Array.from({ length: num_chains }, (_, i) => (
              <option key={i} value={i}>
                {i}{chainValid && !chainValid[i] ? " ✗" : ""}
              </option>
            ))}
          </select>
          {!chainIsValid && (
            <span className="simplex-explorer-chain-invalid" title="This chain diverged">✗ diverged</span>
          )}
        </div>

        <div className="simplex-explorer-control-group">
          <label>Input</label>
          <input
            list="simplex-input-list"
            value={selectedInput}
            onChange={handleInputChange}
            style={{ width: "100px", fontFamily: "monospace" }}
          />
          <datalist id="simplex-input-list">
            {task.inputs.map((inp, i) => (
              <option key={i} value={inp}>
                {inp || "(empty)"} → {task.outputs[i]}
              </option>
            ))}
          </datalist>
        </div>

        <div className="simplex-explorer-control-group simplex-explorer-step-group">
          <label>Step {step}</label>
          <input
            type="range"
            min={0}
            max={numSteps - 1}
            value={step}
            onChange={handleStepChange}
          />
        </div>

        <div className="simplex-explorer-control-group">
          <label>Mode</label>
          <select
            value={renderMode}
            onChange={(e) => setRenderMode(e.target.value as "heatmap" | "path")}
          >
            <option value="heatmap">Heatmap</option>
            <option value="path">Path</option>
          </select>
        </div>
      </div>

      {/* Error / loading */}
      {error && (
        <div className="simplex-explorer-error">Error loading data: {error}</div>
      )}

      {loading && (
        <div className="simplex-explorer-loading">Loading trajectory data...</div>
      )}

      {/* Main content */}
      {!loading && !error && trajData && (
        <div className="simplex-explorer-content">
          {/* Left column: simplex + detail panel + trajectory */}
          <div className="simplex-explorer-left">
            {/* Simplex view */}
            <div className="simplex-explorer-simplex">
              {simplexCode && (
                <NoisyTMSimplex
                  model={uiModel}
                  code={simplexCode}
                  step={simplexStep}
                  renderMode={renderMode}
                  tangent={tangentAtStep ?? undefined}
                />
              )}
            </div>

            {/* Detail panel + trajectory (like simulator) */}
            {tmHistory && (
              <details className="simplex-explorer-trajectory-section" open>
                <summary>
                  Trajectory: {selectedInput || "(empty)"} → {task.outputs[task.inputs.indexOf(selectedInput)] ?? "?"} (step {step})
                </summary>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                  {/* Cell detail panel (shows simplex on hover/pin) */}
                  <div className="interactive-noisy-tm-detail">
                    <div className="interactive-noisy-tm-detail-header">
                      {showingActiveCell ? (
                        `${activeCell!.section}${activeCell!.column != null ? ` col ${activeCell!.column}` : ""} t=${activeCell!.timestep}`
                      ) : "Final State"}
                    </div>
                    {showingActiveCell ? (
                      <CellDetailPanel
                        labels={activeCellData!.labels}
                        probs={activeCellData!.probs}
                        type={activeCellData!.type}
                        pinned={hoveredCell == null && pinnedCell != null}
                      />
                    ) : finalStateProbs ? (
                      <CellDetailPanel
                        labels={model.states}
                        probs={finalStateProbs}
                        type="state"
                      />
                    ) : null}
                  </div>
                  {/* Trajectory with symbol overlays */}
                  <div className="simplex-explorer-trajectory">
                    <TMTrajectory
                      model={trajectoryModel}
                      history={tmHistory}
                      noisy={true}
                      showSimplex={false}
                      showSymbols={true}
                      pinnedCell={pinnedCell}
                      onPinCell={setPinnedCell}
                      onHoverCell={setHoveredCell}
                    />
                  </div>
                </div>
              </details>
            )}
          </div>

          {/* Resize handle */}
          <div className="simplex-explorer-resize" onMouseDown={onResizeStart} />

          {/* Right column: charts */}
          <div className="simplex-explorer-right" style={{ width: chartsWidth }}>
            {/* Loss over steps */}
            {lossChartData && (
              <div className="simplex-explorer-chart">
                <Plot
                  data={[
                    {
                      type: "scatter" as const,
                      mode: "lines" as const,
                      x: lossChartData.steps,
                      y: lossChartData.loss,
                      name: "L(π)",
                      line: { color: "rgb(31,119,180)", width: 1.5 },
                      hovertemplate: "step=%{x}<br>L=%{y:.4f}<extra></extra>",
                    },
                    ...(lossChartData.psLoss ? [{
                      type: "scatter" as const,
                      mode: "lines" as const,
                      x: lossChartData.steps,
                      y: lossChartData.psLoss,
                      name: `ℓ_${selectedInput}`,
                      line: { color: "#dc2626", width: 1, dash: "dot" as const },
                      hovertemplate: `step=%{x}<br>ℓ_${selectedInput}=%{y:.4f}<extra></extra>`,
                    }] : []),
                  ]}
                  layout={{
                    title: { text: "Loss over sampling steps", font: { size: 13 } } as any,
                    xaxis: { title: "Step" as any },
                    yaxis: { title: "Loss" as any },
                    autosize: true,
                    height: 250,
                    margin: { l: 50, r: 20, t: 40, b: 40 },
                    dragmode: "zoom",
                    showlegend: true,
                    legend: { x: 1, xanchor: "right" as const, y: 1 },
                    shapes: [{
                      type: "line" as const,
                      x0: step, x1: step,
                      y0: 0, y1: 1, yref: "paper" as const,
                      line: { color: "#ef4444", width: 1.5, dash: "dash" as const },
                    }],
                  }}
                  config={{ responsive: false, displayModeBar: false }}
                  style={{ width: "100%" }}
                />
              </div>
            )}

            {/* Per-input loss bar at current step */}
            {barData && (
              <div className="simplex-explorer-chart">
                <Plot
                  data={[{
                    type: "bar" as const,
                    x: task.inputs.map((inp) => inp || "(empty)"),
                    y: barData.losses,
                    marker: {
                      color: barData.colors,
                      line: { color: barData.borderColors, width: 2 },
                    },
                    hovertemplate: "x=%{x}<br>ℓ_x=%{y:.4f}<extra></extra>",
                  }]}
                  layout={{
                    title: { text: `Per-input loss ℓ_x at step ${step}`, font: { size: 13 } } as any,
                    xaxis: {
                      title: "Input" as any,
                      tickfont: { size: 8 },
                      tickangle: -45,
                      type: "category" as const,
                      dtick: 1,
                    },
                    yaxis: { title: "ℓ_x" as any, range: psLossRange ?? undefined },
                    autosize: true,
                    height: 220,
                    margin: { l: 50, r: 20, t: 40, b: 80 },
                    dragmode: "zoom",
                    showlegend: false,
                    shapes: [{
                      type: "line" as const,
                      x0: 0, x1: 1, xref: "paper" as const,
                      y0: barData.totalLoss, y1: barData.totalLoss,
                      line: { color: "#dc2626", width: 1, dash: "dot" as const },
                    }],
                    annotations: [{
                      x: 1, xref: "paper" as const, xanchor: "left" as const,
                      y: barData.totalLoss, yref: "y" as const,
                      text: `L=${isFinite(barData.totalLoss) ? barData.totalLoss.toFixed(4) : "∞"}`,
                      showarrow: false,
                      font: { size: 10, color: "#dc2626" },
                      xshift: 4,
                    }],
                  }}
                  config={{ responsive: false, displayModeBar: false }}
                  style={{ width: "100%" }}
                  onClick={(e: any) => {
                    const idx = e.points?.[0]?.pointIndex;
                    if (idx != null && task.inputs[idx] != null) {
                      setSelectedInput(task.inputs[idx]);
                    }
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
