import RawPlot from "../plotly";

/** Thin wrapper around react-plotly.js for use inside MDX.
 *
 *  - Takes inline `data` and `layout` (same shape as plotly.js / a
 *    plotly_json artifact). No fetching: the MDX is self-contained.
 *  - Adds the autosize + responsive defaults that everything else in
 *    Strata uses, plus a sized wrapper div so plots have a height.
 *
 *  For embedding an existing Strata artifact, use <Artifact uri="..." />
 *  instead — that component handles the fetch and dispatches to this one.
 */
interface Props {
  data: unknown[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  height?: number | string;
  style?: React.CSSProperties;
}

export function Plot({ data, layout, config, height = 400, style }: Props) {
  const wrapperStyle: React.CSSProperties = {
    width: "100%",
    height: typeof height === "number" ? `${height}px` : height,
    ...style,
  };
  return (
    <div style={wrapperStyle}>
      <RawPlot
        data={data as never}
        layout={{ ...(layout ?? {}), autosize: true } as never}
        config={{ responsive: true, ...(config ?? {}) } as never}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
