// @ts-nocheck
/** Per-TM susceptibility heatmap with rows permuted by structural input
 *  partition (I_1 first, then I_2, then I_0), thick black dividers between
 *  blocks, and per-block annotations showing discrete rank.
 *
 *  Reads from a zarr group with arrays:
 *    permuted_sus       [N, num_inputs, num_components] — already permuted
 *    partition_sizes    [N, 3] — (|I_1|, |I_2|, |I_0|)
 *    discrete_rank      [N, 4] — (rk(X_11), rk(X_12), rk(X_21), rk(X_22))
 *    effective_rank     [N, 4] — same block ordering
 *    input_permutation  [N, num_inputs] — maps row j → original input index
 *
 *  params (from panel spec):
 *    inputs: string[]  — original input labels (e.g. task.inputs)
 *    components: string[] — WR component labels (e.g. ["(_,q0).s", ...])
 *    q1_cols: number[] — column indices for s_1-row WRs (default [5,6,7,8,9])
 *    q2_cols: number[] — column indices for s_2-row WRs (default [10,11,12,13,14])
 */
import Plot from "../../plotly";
import { useZarrGroup, useGroupArray, useArrayRowsBatch } from "./helpers";
import type { TmSpacePanelProps } from "./types";

interface Params {
  inputs?: string[];
  components?: string[];
  q1_cols?: number[];
  q2_cols?: number[];
}

export function StructuralSusHeatmap({ tmIndex, zarrGroup, params }: TmSpacePanelProps) {
  const p = (params ?? {}) as Params;
  const inputs = p.inputs ?? [];
  const components = p.components ?? [];
  const q1_cols = p.q1_cols ?? [5, 6, 7, 8, 9];
  const q2_cols = p.q2_cols ?? [10, 11, 12, 13, 14];

  const { group, loading: groupLoading, error: groupErr } = useZarrGroup(zarrGroup);
  const susArr = useGroupArray(group, "permuted_sus");
  const partArr = useGroupArray(group, "partition_sizes");
  const permArr = useGroupArray(group, "input_permutation");
  const rkArr = useGroupArray(group, "discrete_rank");
  const erArr = useGroupArray(group, "effective_rank");

  // Batched fetch: all 5 slices for the current TM arrive in a single state
  // update, so the consumer (Plot) only re-renders once per tmIndex change.
  const batch = useArrayRowsBatch(
    { sus: susArr, part: partArr, perm: permArr, rk: rkArr, er: erArr },
    tmIndex,
  );
  const anyErr = groupErr || batch.error;

  // First-load fallbacks. Once we have data we DO NOT unmount on subsequent
  // loading transitions — Plot stays alive and `Plotly.react()` diff-updates
  // when new data arrives. This avoids the heatmap flicker on TM hover.
  if (anyErr) return <div style={{ padding: 12, color: "#b91c1c" }}>Error: {anyErr}</div>;
  if (groupLoading || !susArr || !partArr || !permArr || !rkArr) {
    return <div style={{ padding: 12 }}>Loading group...</div>;
  }
  if (!batch.data) {
    return <div style={{ padding: 12 }}>Loading data...</div>;
  }

  const { sus, part, perm, rk, er } = batch.data;

  // sus is a typed-array slice of shape [num_inputs * num_components]
  const susShape = susArr.shape;       // [N, num_inputs, num_components]
  const numInputs = susShape[1];
  const numComps = susShape[2];

  // Reshape into z[row][col]
  const z: number[][] = [];
  for (let r = 0; r < numInputs; r++) {
    const row: number[] = [];
    for (let c = 0; c < numComps; c++) {
      row.push(sus.data[r * numComps + c]);
    }
    z.push(row);
  }

  // Y-axis labels: for each permuted row, look up the original input index
  const yLabels: string[] = [];
  for (let j = 0; j < numInputs; j++) {
    const origIdx = perm.data[j];
    yLabels.push(inputs[Number(origIdx)] ?? `idx${origIdx}`);
  }

  // partition sizes
  const I1 = Number(part.data[0]);
  const I2 = Number(part.data[1]);
  const I0 = Number(part.data[2]);

  // ranks per block: order is X11, X12, X21, X22
  const ranks = [rk.data[0], rk.data[1], rk.data[2], rk.data[3]].map(Number);
  const eranks = er ? [er.data[0], er.data[1], er.data[2], er.data[3]].map((v: any) => Number(v)) : null;

  // Compute block boundaries on x-axis: between Q_1 (s_1 cols) and Q_2 (s_2 cols).
  // Q_1 cols start at min(q1_cols), Q_2 at min(q2_cols). Assume contiguous.
  const q1_lo = Math.min(...q1_cols);
  const q1_hi = Math.max(...q1_cols);
  const q2_lo = Math.min(...q2_cols);
  const q2_hi = Math.max(...q2_cols);
  // Anything before q1_lo is Q_ctrl. Boundaries to draw at q1_lo, q2_lo.
  const colBounds = [q1_lo - 0.5, q2_lo - 0.5];

  // Row boundaries: after I_1 and after I_1 + I_2.
  const rowBounds = [I1 - 0.5, I1 + I2 - 0.5];

  // Compose annotations + shapes
  const shapes: any[] = [];
  // Horizontal row dividers (full width, thick black)
  for (const y of rowBounds) {
    if (y < -0.4 || y > numInputs - 0.6) continue;
    shapes.push({
      type: "line",
      x0: -0.5, x1: numComps - 0.5, y0: y, y1: y,
      line: { color: "black", width: 3 },
      xref: "x", yref: "y",
    });
  }
  // Vertical col dividers (only across the I_1 + I_2 rows; full height)
  for (const x of colBounds) {
    shapes.push({
      type: "line",
      x0: x, x1: x, y0: -0.5, y1: numInputs - 0.5,
      line: { color: "black", width: 3 },
      xref: "x", yref: "y",
    });
  }

  // Block annotations: position at the centre of each block.
  // Blocks of interest are the 2×2 (I_a × Q_b) for a,b ∈ {1,2}.
  const annotations: any[] = [];
  const xCenter = (lo: number, hi: number) => (lo + hi) / 2;
  const yCenter = (lo: number, hi: number) => (lo + hi - 1) / 2;
  const blockSpecs: { name: string; row_lo: number; row_hi: number; col_lo: number; col_hi: number; rk_idx: number }[] = [
    { name: "X11", row_lo: 0,         row_hi: I1,           col_lo: q1_lo, col_hi: q1_hi + 1, rk_idx: 0 },
    { name: "X12", row_lo: 0,         row_hi: I1,           col_lo: q2_lo, col_hi: q2_hi + 1, rk_idx: 1 },
    { name: "X21", row_lo: I1,        row_hi: I1 + I2,      col_lo: q1_lo, col_hi: q1_hi + 1, rk_idx: 2 },
    { name: "X22", row_lo: I1,        row_hi: I1 + I2,      col_lo: q2_lo, col_hi: q2_hi + 1, rk_idx: 3 },
  ];
  for (const b of blockSpecs) {
    if (b.row_hi <= b.row_lo) continue;  // empty block (e.g. |I_2|=0)
    const text = eranks
      ? `<b>${b.name}</b><br>rk=${ranks[b.rk_idx]}<br>er=${eranks[b.rk_idx].toFixed(2)}`
      : `<b>${b.name}</b><br>rk=${ranks[b.rk_idx]}`;
    annotations.push({
      x: xCenter(b.col_lo, b.col_hi - 1),
      y: yCenter(b.row_lo, b.row_hi),
      text,
      showarrow: false,
      font: { size: 10, color: "black" },
      bgcolor: "rgba(255,255,255,0.7)",
      bordercolor: "black",
      borderwidth: 0.5,
    });
  }

  // Z-axis range: symmetric around 0 by max abs
  let absMax = 0;
  for (let r = 0; r < numInputs; r++)
    for (let c = 0; c < numComps; c++)
      if (Math.abs(z[r][c]) > absMax) absMax = Math.abs(z[r][c]);
  const zSpan = absMax > 0 ? absMax : 1;

  return (
    <Plot
      data={[{
        type: "heatmap",
        z, x: components, y: yLabels,
        colorscale: "RdBu", zmid: 0, zmin: -zSpan, zmax: zSpan,
        colorbar: { title: { text: "χ" }, thickness: 12 },
        hovertemplate: "input=%{y}<br>component=%{x}<br>χ=%{z:.4f}<extra></extra>",
      } as any]}
      layout={{
        title: {
          text: `<b>Susceptibility (TM ${tmIndex}), structural row partition</b>`
                + `<br><sub>Top block: I_1 (|I_1|=${I1}), middle: I_2 (|I_2|=${I2}), bottom: I_0 (|I_0|=${I0}). `
                + `Thick lines mark partition / Q_1↔Q_2 boundaries.</sub>`,
          font: { size: 13 },
        },
        xaxis: { title: "Component (WR)", side: "top", type: "category", tickfont: { size: 9 } },
        yaxis: { title: "Input (permuted)", autorange: "reversed", type: "category", tickfont: { size: 9 } },
        shapes, annotations,
        margin: { l: 60, r: 30, t: 80, b: 30 },
        autosize: true,
      }}
      config={{ responsive: true, displayModeBar: false }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
    />
  );
}
