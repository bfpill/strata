/** Per-TM singular value spectrum: one trace per structural block.
 *
 *  Reads from a zarr group with arrays:
 *    block_singular_values  [N, 4, K]  — top-K singular values per block
 *    discrete_rank          [N, 4]     — for marker count / annotation
 *
 *  Block ordering: X_11, X_12, X_21, X_22.
 */
import Plot from "../../plotly";
import { useZarrGroup, useGroupArray, useArrayRowsBatch } from "./helpers";
import type { TmSpacePanelProps } from "./types";

const BLOCK_NAMES = ["X11", "X12", "X21", "X22"] as const;
const BLOCK_COLORS = ["#1e40af", "#dc2626", "#16a34a", "#d97706"];

export function StructuralBlockSigmas({ tmIndex, zarrGroup }: TmSpacePanelProps) {
  const { group, loading: groupLoading, error: groupErr } = useZarrGroup(zarrGroup);
  const sigmasArr = useGroupArray(group, "block_singular_values");
  const rkArr = useGroupArray(group, "discrete_rank");

  const batch = useArrayRowsBatch({ sigmas: sigmasArr, rk: rkArr }, tmIndex);
  const anyErr = groupErr || batch.error;

  if (anyErr) return <div style={{ padding: 12, color: "#b91c1c" }}>Error: {anyErr}</div>;
  if (groupLoading || !sigmasArr || !rkArr) {
    return <div style={{ padding: 12 }}>Loading group...</div>;
  }
  if (!batch.data) return <div style={{ padding: 12 }}>Loading data...</div>;
  const { sigmas, rk } = batch.data;

  const shape = sigmasArr.shape; // [N, 4, K]
  const K = shape[2];

  // Reshape: sigmas[block][k]
  const traces: any[] = [];
  for (let b = 0; b < 4; b++) {
    const ys: number[] = [];
    const xs: number[] = [];
    for (let k = 0; k < K; k++) {
      const v = sigmas.data[b * K + k];
      // Floor for log scale (replace 0 with tiny value)
      ys.push(v > 0 ? v : 1e-20);
      xs.push(k + 1);
    }
    const rkB = Number(rk.data[b]);
    traces.push({
      type: "scatter",
      mode: "markers+lines",
      name: `${BLOCK_NAMES[b]} (rk=${rkB})`,
      x: xs, y: ys,
      marker: { color: BLOCK_COLORS[b], size: 9 },
      line: { color: BLOCK_COLORS[b], width: 2 },
      hovertemplate: `${BLOCK_NAMES[b]}<br>i=%{x}<br>σ_i=%{y:.3e}<extra></extra>`,
    });
  }

  return (
    <Plot
      data={traces}
      layout={{
        title: {
          text: `<b>Block singular value spectra (TM ${tmIndex})</b>`
                + "<br><sub>One trace per structural block. Log y; values at 1e-20 are zero/noise floor. Discrete rank shown in legend.</sub>",
          font: { size: 13 },
        },
        xaxis: { title: "singular value index", dtick: 1 },
        yaxis: { title: "σ_i", type: "log" },
        legend: { orientation: "h", yanchor: "bottom", y: 1.03 },
        margin: { l: 60, r: 30, t: 80, b: 50 },
        autosize: true,
      }}
      config={{ responsive: true, displayModeBar: false }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
    />
  );
}
