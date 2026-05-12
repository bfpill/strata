// @ts-nocheck
import { useState } from "react";
import Plot from "../plotly";
import { TransitionTable, type Model as UIModel, type Code as UICode } from "@noisy-tm/ui";
import "@noisy-tm/ui/src/styles.css";

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

interface SynthConfigProps {
  synth_config: Record<string, any>;
  model: Model;
  task: Task;
  codes: Record<string, Code>;
}

function ModelSummary({ model, task }: { model: Model; task: Task }) {
  const sigma = model.alphabet.map((s) => (s === "_" ? "␣" : s)).join(", ");
  const states = model.states.join(", ");
  const D = model.transition_pairs.length;

  return (
    <div className="synth-summary">
      <span>Σ = {"{"}{sigma}{"}"}</span>
      <span className="synth-sep">·</span>
      <span>Q = {"{"}{states}{"}"}</span>
      <span className="synth-sep">·</span>
      <span>|Σ|={model.alphabet.length}, |Q|={model.states.length}, D={D}</span>
      <span className="synth-sep">·</span>
      <span>T={task.tm_steps} steps</span>
      <span className="synth-sep">·</span>
      <span>N={task.inputs.length} inputs</span>
    </div>
  );
}

function DistributionPlot({ task }: { task: Task }) {
  // Color bars by output state
  const uniqueOutputs = [...new Set(task.outputs)];
  const colorMap: Record<string, string> = {};
  const palette = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d"];
  uniqueOutputs.forEach((o, i) => { colorMap[o] = palette[i % palette.length]; });
  const colors = task.outputs.map((o) => colorMap[o]);

  return (
    <Plot
      data={[{
        type: "bar",
        x: task.inputs,
        y: task.dist,
        marker: { color: colors },
        hovertemplate: "x=%{x}<br>q(x)=%{y:.4f}<br>y=%{customdata}<extra></extra>",
        customdata: task.outputs,
      }]}
      layout={{
        title: { text: "Input Distribution q(x)", font: { size: 13 } } as any,
        xaxis: { title: "Input" as any, tickfont: { size: 9 }, tickangle: -45, type: "category" },
        yaxis: { title: "q(x)" as any },
        height: 300,
        margin: { l: 50, r: 20, t: 40, b: 80 },
        dragmode: "zoom",
        showlegend: false,
      }}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%" }}
    />
  );
}

const PAGE_SIZE = 20;

function TaskTable({ task }: { task: Task }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(task.inputs.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const pageItems = task.inputs.slice(start, start + PAGE_SIZE);

  return (
    <details className="synth-details">
      <summary>Task Table ({task.inputs.length} inputs)</summary>
      <div className="synth-table-wrap">
        <table className="synth-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Input</th>
              <th>Output</th>
              <th>q(x)</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((input, i) => {
              const idx = start + i;
              return (
                <tr key={idx}>
                  <td className="synth-idx">{idx}</td>
                  <td><code>{input}</code></td>
                  <td><code>{task.outputs[idx]}</code></td>
                  <td className="synth-num">{task.dist[idx].toFixed(4)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="synth-pagination">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
            <span>{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </details>
  );
}

function CodeDisplay({ name, code, model }: { name: string; code: Code; model: Model }) {
  const stringCode: UICode<string> = {
    writes: code.writes.map((ix) => model.alphabet[ix]),
    states: code.states.map((ix) => model.states[ix]),
    moves: code.moves.map((ix) => model.dirs[ix]),
  };

  const uiModel: UIModel = {
    alphabet: model.alphabet,
    states: model.states,
    transition_pairs: model.transition_pairs,
    dirs: model.dirs as ("S" | "L" | "R")[],
  };

  return (
    <details className="synth-details" open>
      <summary>{name}</summary>
      <TransitionTable model={uiModel} data={stringCode} size="compact" />
    </details>
  );
}

export function SynthConfig({ synth_config, model, task, codes }: SynthConfigProps) {
  return (
    <div className="section">
      <h3>Synthesis Problem: {synth_config.name}</h3>
      <ModelSummary model={model} task={task} />
      {Object.entries(codes).map(([name, code]) => (
        <CodeDisplay key={name} name={name} code={code} model={model} />
      ))}
      <DistributionPlot task={task} />
      <TaskTable task={task} />
    </div>
  );
}
