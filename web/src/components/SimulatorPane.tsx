import { useState, useMemo, useCallback, useRef } from "react";
import Plot from "../plotly";
import {
  InteractiveNoisyTM,
  relaxCode,
  runNoisyTMFinalState,
  prepareNoisyRun,
  type TMModelConfig,
  type NoisyTMCode,
  type TMCodeData,
  type HeatmapMode,
  type HeatmapConfig,
} from "@noisy-tm/ui";
import "@noisy-tm/ui/src/InteractiveNoisyTM.css";
import "@noisy-tm/ui/src/TMTrajectory.css";
import "@noisy-tm/ui/src/styles.css";
import { TMGraph } from "./TMGraph";

type EditorView = "table" | "graph";

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

export interface SimulatorPaneParams {
  code?: string;
  input?: string;
  steps?: string;
  plot?: string;
  sens?: string;
  hm?: string;       // heatmap mode
  hmN?: string;      // grid resolution
  hmK?: string;      // truncation half-width
  hmBeta?: string;   // beta for exp(-beta*L) modes
  hmAuto?: string;   // "0" or "1"
}

export interface SimulatorPaneProps {
  model: Model;
  task: Task;
  codes: Record<string, Code>;
  /** Initial param values from URL */
  params?: SimulatorPaneParams;
  /** Called when user changes a param */
  onParamsChange?: (params: SimulatorPaneParams) => void;
  /** Hide the code selector dropdown (when code selection is managed externally) */
  hideCodeSelector?: boolean;
}

export function SimulatorPane({ model, task, codes, params, onParamsChange, hideCodeSelector }: SimulatorPaneProps) {
  const codeNames = useMemo(() => Object.keys(codes), [codes]);
  const [selectedCodeName, setSelectedCodeName] = useState(params?.code && codeNames.includes(params.code) ? params.code : codeNames[0] ?? "");

  // When codes change externally (e.g. code browser), sync selection to first available key
  const prevCodesRef = useRef(codes);
  if (codes !== prevCodesRef.current) {
    prevCodesRef.current = codes;
    const firstKey = Object.keys(codes)[0] ?? "";
    if (!codes[selectedCodeName] && firstKey) {
      setSelectedCodeName(firstKey);
    }
  }
  const [selectedInput, setSelectedInput] = useState(params?.input && task.inputs.includes(params.input) ? params.input : task.inputs[0] ?? "");
  const [customSteps, setCustomSteps] = useState<number | null>(params?.steps ? parseInt(params.steps) || null : null);
  const [sensitivity, setSensitivity] = useState(params?.sens ? parseInt(params.sens) || 1 : 1);
  const [plotMode, setPlotMode] = useState<"loss" | "deviation" | "phi_deviation">(
    (params?.plot as any) === "deviation" || (params?.plot as any) === "phi_deviation" ? params!.plot as any : "loss",
  );
  const [editorView, setEditorView] = useState<EditorView>("table");

  // Heatmap (loss-field overlay) controls.
  const VALID_HM: HeatmapMode[] = ["off", "l_x", "L", "exp_l_x", "exp_L"];
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>(
    (params?.hm && VALID_HM.includes(params.hm as any) ? params.hm : "off") as HeatmapMode,
  );
  const [heatmapN, setHeatmapN] = useState<number>(() => {
    const v = params?.hmN ? parseInt(params.hmN) : 128;
    return Math.max(8, Math.min(512, isFinite(v) ? v : 128));
  });
  const [heatmapKBound, setHeatmapKBound] = useState<number>(() => {
    const v = params?.hmK ? parseFloat(params.hmK) : 30;
    return Math.max(1, Math.min(200, isFinite(v) ? v : 30));
  });
  const [heatmapBeta, setHeatmapBeta] = useState<number>(() => {
    const v = params?.hmBeta ? parseFloat(params.hmBeta) : 1;
    return isFinite(v) ? v : 1;
  });
  // Default OFF: compute is opt-in via the Compute button. URL param "hmAuto=1"
  // turns it back on (eager recompute on every code/input change).
  const [heatmapAuto, setHeatmapAuto] = useState<boolean>(params?.hmAuto === "1");
  const [heatmapTrigger, setHeatmapTrigger] = useState<number>(0);

  const numSteps = customSteps ?? task.tm_steps;

  // Sync state changes to URL
  const notify = useCallback((overrides: Partial<SimulatorPaneParams>) => {
    onParamsChange?.({
      code: overrides.code ?? selectedCodeName,
      input: overrides.input ?? selectedInput,
      steps: overrides.steps ?? (customSteps ? String(customSteps) : undefined),
      plot: overrides.plot ?? plotMode,
      sens: overrides.sens ?? (sensitivity > 1 ? String(sensitivity) : undefined),
      hm: overrides.hm ?? (heatmapMode !== "off" ? heatmapMode : undefined),
      hmN: overrides.hmN ?? (heatmapN !== 128 ? String(heatmapN) : undefined),
      hmK: overrides.hmK ?? (heatmapKBound !== 30 ? String(heatmapKBound) : undefined),
      hmBeta: overrides.hmBeta ?? (heatmapBeta !== 1 ? String(heatmapBeta) : undefined),
      hmAuto: overrides.hmAuto ?? (heatmapAuto ? "1" : undefined),
    });
  }, [onParamsChange, selectedCodeName, selectedInput, customSteps, plotMode, sensitivity, heatmapMode, heatmapN, heatmapKBound, heatmapBeta, heatmapAuto]);

  const modelConfig: TMModelConfig = useMemo(
    () => ({
      alphabet: model.alphabet,
      states: model.states,
      dirs: model.dirs as ("L" | "S" | "R")[],
      transition_pairs: model.transition_pairs,
      skip_staging: model.skip_staging,
    }),
    [model],
  );

  // Relax the selected deterministic code to a NoisyTMCode
  const initialNoisyCode: NoisyTMCode | null = useMemo(() => {
    const code = codes[selectedCodeName];
    if (!code) return null;
    const tmCode: TMCodeData = {
      writes: code.writes,
      states: code.states,
      moves: code.moves,
    };
    return relaxCode(tmCode, modelConfig);
  }, [selectedCodeName, codes, modelConfig]);

  // Lifted code state (controlled by InteractiveNoisyTM via onCodeChange)
  const [code, setCode] = useState<NoisyTMCode | null>(initialNoisyCode);

  // Reset code when switching codes
  const prevCodeNameRef = useMemo(() => ({ current: selectedCodeName }), []);
  if (selectedCodeName !== prevCodeNameRef.current) {
    prevCodeNameRef.current = selectedCodeName;
    setCode(initialNoisyCode);
  }

  const handleCodeChange = useCallback((newCode: NoisyTMCode) => {
    setCode(newCode);
  }, []);

  // Color palette by output class (matches SynthConfig DistributionPlot)
  const outputColorMap = useMemo(() => {
    const palette = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d"];
    const uniqueOutputs = [...new Set(task.outputs)];
    const map: Record<string, string> = {};
    uniqueOutputs.forEach((o, i) => { map[o] = palette[i % palette.length]; });
    return map;
  }, [task.outputs]);

  const detailPortalRef = useRef<HTMLDivElement>(null);

  // Validate that selectedInput only contains symbols from the alphabet (excluding blank)
  const inputValid = useMemo(() => {
    if (!selectedInput) return true; // empty is fine
    const validSymbols = new Set(model.alphabet.slice(1)); // exclude blank (index 0)
    return [...selectedInput].every((ch) => validSymbols.has(ch));
  }, [selectedInput, model.alphabet]);

  // Compute -log(P(correct final state)) for all inputs
  const lossData = useMemo(() => {
    const ntm = code ?? initialNoisyCode;
    if (!ntm) return null;

    const losses: number[] = [];
    const colors: string[] = [];
    const borderColors: string[] = [];

    for (let i = 0; i < task.inputs.length; i++) {
      const inp = task.inputs[i];
      const expectedOutput = task.outputs[i];
      const expectedIdx = model.states.indexOf(expectedOutput);

      const { initialTape, initialState, headZero } = prepareNoisyRun(
        modelConfig, inp, numSteps,
      );
      const finalState = runNoisyTMFinalState(
        ntm, numSteps, modelConfig, headZero, initialTape, initialState,
      );

      const prob = expectedIdx >= 0 ? finalState[expectedIdx] : 0;
      const isInf = prob < 1e-30;
      losses.push(isInf ? Infinity : -Math.log(prob));
      colors.push(outputColorMap[expectedOutput] || "#94a3b8");
      borderColors.push(inp === selectedInput ? "#000000" : "rgba(0,0,0,0)");
    }

    // For overall loss, treat Infinity as a large finite value for weighted sum
    // (conceptually L(w) = ∞ if any input with nonzero weight has ℓ_x = ∞)
    const hasInf = losses.some((l) => !isFinite(l));
    let overallLoss = 0;
    for (let i = 0; i < losses.length; i++) {
      overallLoss += task.dist[i] * (isFinite(losses[i]) ? losses[i] : 0);
    }
    if (hasInf) overallLoss = Infinity;

    // For plotting: cap infinite bars well above the max finite value
    const finiteLosses = losses.filter(isFinite);
    const maxFinite = finiteLosses.length > 0 ? Math.max(...finiteLosses) : 0;
    const infCap = Math.max(maxFinite + 2, maxFinite * 2, 3);
    const plotLosses = losses.map((l) => isFinite(l) ? l : infCap);

    // ℓ_x - L: deviation from mean loss (use finite overallLoss for deviation calc)
    const finiteOverallLoss = isFinite(overallLoss) ? overallLoss : 0;
    const deviations = plotLosses.map((l) => l - finiteOverallLoss);
    // φ · (ℓ_x - L) where φ = L(w)
    const phiDeviations = deviations.map((d) => finiteOverallLoss * d);

    // Indices of infinite-loss inputs for annotation
    const infIndices = losses.map((l, i) => !isFinite(l) ? i : -1).filter((i) => i >= 0);

    return { losses: plotLosses, deviations, phiDeviations, colors, borderColors, overallLoss, infCap, infIndices };
  }, [code, initialNoisyCode, task, model, modelConfig, numSteps, selectedInput, outputColorMap]);

  if (!initialNoisyCode) {
    return <div style={{ padding: "2rem", color: "#6b7280" }}>No codes available for simulation.</div>;
  }

  const activeCode = code ?? initialNoisyCode;

  return (
    <div className="simulator-pane">
      {/* Collapsible guide */}
      <details className="simulator-guide">
        <summary>How to use this simulator</summary>
        <div className="simulator-guide-body">
          <p>
            This simulator lets you explore the loss landscape of a NoisyTM by interactively
            perturbing the transition table away from the deterministic code.
          </p>
          <h4>Editor (left)</h4>
          <p>
            Each cell starts as a compact chip showing the deterministic value.
            <strong> Click</strong> a chip to expand it into a simplex editor where you can
            drag to perturb the probability distribution. Click the <strong>&times;</strong> button
            to collapse it back.
          </p>
          <ul>
            <li><strong>Amber border</strong> = this parameter affects the final state for the <em>current</em> input (smoke tested on load and after each drag).</li>
            <li><strong>Dashed amber border</strong> = not sensitive for the current input, but sensitive for <em>some other</em> input. Helps identify which transitions matter elsewhere.</li>
            <li><strong>Grey border</strong> = not sensitive for any input.</li>
            <li><strong>Blue filled dot</strong> = deterministic (one-hot). <strong>Amber dot</strong> = noisy (mixed distribution).</li>
            <li><strong>Double-click</strong> a simplex to reset it to the original code.</li>
            <li><strong>Hold Shift</strong> while dragging for 10&times; finer control. Use the Sensitivity dropdown for 100&times; or 1000&times;.</li>
            <li><strong>4+ values</strong>: click vertex labels to unlock up to 3 components. Locked components stay fixed; unlocked ones form a sub-simplex you can drag on.</li>
            <li>Probabilities shown in scientific notation below each simplex.</li>
          </ul>
          <h4>Trajectory (right)</h4>
          <p>
            Shows the full NoisyTM execution history for the selected input. Each cell shows
            overlaid symbols with opacity proportional to probability.
          </p>
          <ul>
            <li><strong>Amber tint + corner dot</strong> = cell distribution is noisy (not deterministic). Tint intensity scales with entropy.</li>
            <li><strong>Hover</strong> a cell to see the full simplex + probabilities in scientific notation.</li>
            <li><strong>Hover a row</strong> in the editor to see blue highlights on timesteps where that transition fires (via &lambda;).</li>
          </ul>
          <h4>Bar chart</h4>
          <p>
            Shows a per-input quantity for all inputs at once. Bars are coloured by output class.
            Click a bar to select that input for the trajectory.
          </p>
          <ul>
            <li><strong>&ell;_x(w)</strong>: per-input loss = &minus;log P(correct final state | input, w). Dotted red line = overall loss L(w) = &Sigma; q(x) &ell;_x(w).</li>
            <li><strong>&ell;_x &minus; L</strong>: deviation from mean. Shows which inputs are harder/easier than average. This is the quantity correlated with &phi; in the susceptibility formula.</li>
            <li><strong>&phi; &middot; (&ell;_x &minus; L)</strong>: the integrand of the susceptibility first term, where &phi; = L(w). At a deterministic code this is zero; as you perturb, it shows each input&rsquo;s instantaneous contribution to susceptibility.</li>
          </ul>
        </div>
      </details>
      {/* Controls bar */}
      <div className="simulator-controls">
        {!hideCodeSelector && (
          <div className="simulator-control-group">
            <label>Code</label>
            <select
              value={selectedCodeName}
              onChange={(e) => { setSelectedCodeName(e.target.value); notify({ code: e.target.value }); }}
            >
              {codeNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="simulator-control-group">
          <label>Input</label>
          <input
            list="sim-input-list"
            value={selectedInput}
            onChange={(e) => { setSelectedInput(e.target.value); notify({ input: e.target.value }); }}
            style={{ width: "100px", fontFamily: "monospace" }}
          />
          <datalist id="sim-input-list">
            {task.inputs.map((inp, i) => (
              <option key={i} value={inp}>
                {inp || "(empty)"} → {task.outputs[i]}
              </option>
            ))}
          </datalist>
        </div>

        <div className="simulator-control-group">
          <label>Steps</label>
          <input
            type="number"
            min={1}
            max={200}
            value={numSteps}
            onChange={(e) => { const v = Math.max(1, Math.min(200, parseInt(e.target.value) || 1)); setCustomSteps(v); notify({ steps: String(v) }); }}
            style={{ width: "60px" }}
          />
        </div>

        <div className="simulator-control-group">
          <label>Sensitivity</label>
          <select
            value={sensitivity}
            onChange={(e) => { const v = Number(e.target.value); setSensitivity(v); notify({ sens: v > 1 ? String(v) : undefined }); }}
          >
            <option value={1}>1x</option>
            <option value={10}>10x</option>
            <option value={100}>100x</option>
            <option value={1000}>1000x</option>
          </select>
        </div>

        <div className="simulator-control-group">
          <label>Plot</label>
          <select
            value={plotMode}
            onChange={(e) => { setPlotMode(e.target.value as any); notify({ plot: e.target.value }); }}
          >
            <option value="loss">ℓ_x(w)</option>
            <option value="deviation">ℓ_x - L</option>
            <option value="phi_deviation">φ · (ℓ_x - L)</option>
          </select>
        </div>

        <div className="simulator-control-group">
          <label>Heatmap</label>
          <select
            value={heatmapMode}
            onChange={(e) => { const v = e.target.value as HeatmapMode; setHeatmapMode(v); notify({ hm: v !== "off" ? v : undefined }); }}
          >
            <option value="off">off</option>
            <option value="l_x">ℓ_x</option>
            <option value="L">L</option>
            <option value="exp_l_x">exp(-β·ℓ_x)</option>
            <option value="exp_L">exp(-β·L)</option>
          </select>
        </div>

        {heatmapMode !== "off" && (
          <>
            <div className="simulator-control-group">
              <label>n</label>
              <input
                type="number"
                min={8}
                max={512}
                step={1}
                value={heatmapN}
                onChange={(e) => { const v = Math.max(8, Math.min(512, parseInt(e.target.value) || 128)); setHeatmapN(v); notify({ hmN: v !== 128 ? String(v) : undefined }); }}
                style={{ width: "60px" }}
                title="Grid resolution per axis (z-space). 128² = 16k forward passes per simplex per input."
              />
            </div>
            <div className="simulator-control-group">
              <label>k</label>
              <input
                type="number"
                min={1}
                max={200}
                step={1}
                value={heatmapKBound}
                onChange={(e) => { const v = Math.max(1, Math.min(200, parseFloat(e.target.value) || 30)); setHeatmapKBound(v); notify({ hmK: v !== 30 ? String(v) : undefined }); }}
                style={{ width: "55px" }}
                title="ALR truncation half-width: z ∈ [-k, k]. Larger k → closer to simplex vertices."
              />
            </div>
            {(heatmapMode === "exp_l_x" || heatmapMode === "exp_L") && (
              <div className="simulator-control-group">
                <label>β</label>
                <input
                  type="number"
                  step={0.1}
                  value={heatmapBeta}
                  onChange={(e) => { const v = parseFloat(e.target.value); const v2 = isFinite(v) ? v : 1; setHeatmapBeta(v2); notify({ hmBeta: v2 !== 1 ? String(v2) : undefined }); }}
                  style={{ width: "60px" }}
                  title="Inverse temperature for exp(-β·loss). Pure render-time transform; no recompute."
                />
              </div>
            )}
            <div className="simulator-control-group">
              <label>
                <input
                  type="checkbox"
                  checked={heatmapAuto}
                  onChange={(e) => { setHeatmapAuto(e.target.checked); notify({ hmAuto: e.target.checked ? "1" : undefined }); }}
                  style={{ marginRight: "4px" }}
                />
                Auto
              </label>
            </div>
            {!heatmapAuto && (
              <div className="simulator-control-group">
                <button
                  type="button"
                  onClick={() => setHeatmapTrigger((t) => t + 1)}
                  title="Compute heatmaps for all expanded simplices"
                >
                  Compute
                </button>
              </div>
            )}
          </>
        )}

      </div>

      {/* Invalid input warning */}
      {!inputValid && (
        <div style={{ padding: "0.5rem 0", color: "#dc2626", fontSize: "0.85rem" }}>
          Invalid input: characters must be from {"{"}{model.alphabet.slice(1).join(", ")}{"}"}
        </div>
      )}

      {/* Detail panel + Loss bar chart row (collapsible) */}
      <details className="simulator-charts-section" open>
        <summary>Loss chart</summary>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <div ref={detailPortalRef} />
        {inputValid && lossData && (() => {
        const xLabels = task.inputs.map((inp) => inp || "(empty)");
        const minYMax = 1 / sensitivity;

        // Text labels on bars: show ∞ for infinite-loss inputs
        const infSet = new Set(lossData.infIndices);
        const barText = xLabels.map((_, i) => infSet.has(i) ? "∞" : "");

        const lossOverallFinite = isFinite(lossData.overallLoss);
        const lossLineY = lossOverallFinite ? lossData.overallLoss : lossData.infCap;

        const plotConfigs = {
          loss: {
            y: lossData.losses,
            title: "ℓ_x(w) = -log P(correct state | input, w)",
            yTitle: "-log P",
            hoverTemplate: "x=%{x}<br>ℓ_x=%{y:.4f}<extra></extra>",
            yRange: [0, Math.max(minYMax, ...lossData.losses) * 1.1] as [number, number],
            shapes: [{
              type: "line" as const,
              x0: 0, x1: 1, xref: "paper" as const,
              y0: lossLineY, y1: lossLineY, yref: "y" as const,
              line: { color: "#dc2626", width: 1.5, dash: "dot" as const },
            }],
            annotations: [
              {
                x: 1, xref: "paper" as const, xanchor: "left" as const,
                y: lossLineY, yref: "y" as const,
                text: lossOverallFinite ? `L(w)=${lossData.overallLoss.toFixed(4)}` : "L(w)=∞",
                showarrow: false,
                font: { size: 10, color: "#dc2626" },
                xshift: 4,
              },
            ],
          },
          deviation: {
            y: lossData.deviations,
            title: "ℓ_x(w) − L(w)  (deviation from mean)",
            yTitle: "ℓ_x − L",
            hoverTemplate: "x=%{x}<br>ℓ_x−L=%{y:.4f}<extra></extra>",
            yRange: (() => {
              const maxAbs = Math.max(minYMax, ...lossData.deviations.map(Math.abs));
              return [-maxAbs * 1.1, maxAbs * 1.1] as [number, number];
            })(),
            shapes: [{
              type: "line" as const,
              x0: 0, x1: 1, xref: "paper" as const,
              y0: 0, y1: 0, yref: "y" as const,
              line: { color: "#94a3b8", width: 1, dash: "dot" as const },
            }],
            annotations: [] as any[],
          },
          phi_deviation: {
            y: lossData.phiDeviations,
            title: "φ(w) · (ℓ_x(w) − L(w))  where φ = L(w)",
            yTitle: "φ · (ℓ_x − L)",
            hoverTemplate: "x=%{x}<br>φ·(ℓ_x−L)=%{y:.6f}<extra></extra>",
            yRange: (() => {
              const ol = isFinite(lossData.overallLoss) ? lossData.overallLoss : 0.01;
              const maxAbs = Math.max(minYMax * ol, ...lossData.phiDeviations.map(Math.abs));
              return [-maxAbs * 1.1, maxAbs * 1.1] as [number, number];
            })(),
            shapes: [{
              type: "line" as const,
              x0: 0, x1: 1, xref: "paper" as const,
              y0: 0, y1: 0, yref: "y" as const,
              line: { color: "#94a3b8", width: 1, dash: "dot" as const },
            }],
            annotations: [
              {
                x: 1, xref: "paper" as const, xanchor: "left" as const,
                y: 0, yref: "y" as const,
                text: lossOverallFinite ? `φ=L(w)=${lossData.overallLoss.toFixed(4)}` : "φ=L(w)=∞",
                showarrow: false,
                font: { size: 10, color: "#64748b" },
                xshift: 4,
              },
            ],
          },
        };

        const cfg = plotConfigs[plotMode];

        return (
          <div style={{ flex: 1, minWidth: 0 }}>
            <Plot
              data={[{
                type: "bar",
                x: xLabels,
                y: cfg.y,
                text: barText,
                textposition: "outside",
                textfont: { size: 12, color: "#991b1b", family: "serif" },
                marker: { color: lossData.colors, line: { color: lossData.borderColors, width: 2 } },
                hovertemplate: cfg.hoverTemplate,
              }]}
              layout={{
                title: { text: cfg.title, font: { size: 13 } } as any,
                xaxis: { title: "Input" as any, tickfont: { size: 9 }, tickangle: -45, type: "category", dtick: 1 },
                yaxis: { title: cfg.yTitle as any, range: cfg.yRange },
                height: 280,
                margin: { l: 50, r: 80, t: 40, b: 100 },
                dragmode: "zoom",
                showlegend: false,
                shapes: cfg.shapes,
                annotations: cfg.annotations,
              }}
              config={{ responsive: true, displayModeBar: false }}
              useResizeHandler={true}
              style={{ width: "100%", height: "100%" }}
              onClick={(e: any) => {
                const pointIdx = e.points?.[0]?.pointIndex;
                if (pointIdx != null && task.inputs[pointIdx] != null) {
                  setSelectedInput(task.inputs[pointIdx]);
                  notify({ input: task.inputs[pointIdx] });
                }
              }}
            />
          </div>
        );
      })()}
      </div>
      </details>

      {/* View tabs + editor/graph + trajectory */}
      {inputValid && (
        <>
          <div className="simulator-view-tabs">
            <button
              className={`simulator-view-tab ${editorView === "table" ? "active" : ""}`}
              onClick={() => setEditorView("table")}
            >
              Table
            </button>
            <button
              className={`simulator-view-tab ${editorView === "graph" ? "active" : ""}`}
              onClick={() => setEditorView("graph")}
            >
              Graph
            </button>
          </div>

          {editorView === "graph" && (
            <TMGraph model={model} code={codes[selectedCodeName]} />
          )}

          <div className={editorView === "graph" ? "simulator-hide-editor" : ""}>
            <InteractiveNoisyTM
              model={modelConfig}
              code={activeCode}
              onCodeChange={handleCodeChange}
              initialCode={initialNoisyCode}
              input={selectedInput}
              numSteps={numSteps}
              allInputs={task.inputs}
              maxVisibleRows={3}
              sensitivity={sensitivity}
              detailPortalTarget={detailPortalRef.current}
              heatmap={heatmapMode === "off" ? undefined : ({
                mode: heatmapMode,
                n: heatmapN,
                kBound: heatmapKBound,
                beta: heatmapBeta,
                auto: heatmapAuto,
                computeTrigger: heatmapTrigger,
                taskInputs: task.inputs,
                taskOutputs: task.outputs,
                taskDist: task.dist,
                selectedInputIdx: Math.max(0, task.inputs.indexOf(selectedInput)),
              } satisfies HeatmapConfig)}
            />
          </div>
        </>
      )}
    </div>
  );
}
