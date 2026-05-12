import { useEffect, useState } from "react";
import { Plot } from "./Plot";
import { useMDXContext } from "./MDXContext";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://strata.timaeus-research-inc.workers.dev";

/** Render a Strata artifact by its R2 URI, dispatching on file extension.
 *
 *  Three prop forms are supported:
 *    1. Full URI (legacy):   <Artifact uri="experiments/foo/runs/0/artifacts/bar.json"/>
 *    2. Same experiment:     <Artifact run={1} name="bar.json"/>
 *    3. Cross experiment:    <Artifact exp="other-slug" run={2} name="bar.png"/>
 *
 *  Forms (2) and (3) read the surrounding {slug, runIndex} from MDXContext,
 *  which MDXRenderer populates from the MDX writeup's own URI.
 *
 *  Currently supports these extensions:
 *    - .json   → assumed plotly_json, rendered via <Plot/>
 *    - .png/.jpg/.jpeg/.gif/.svg/.webp → <img>
 */
interface PropsBase {
  height?: number | string;
  style?: React.CSSProperties;
  /** Optional layout overrides merged onto the plotly figure's layout. */
  layout?: Record<string, unknown>;
}

/** External-facing prop shape: any combination is valid at the type level;
 *  the resolver in <Artifact/> validates at runtime. */
interface Props extends PropsBase {
  uri?: string;
  exp?: string;
  run?: number;
  name?: string;
}

/** Internal props for the rendering subcomponents — uri is always resolved. */
interface ResolvedProps extends PropsBase {
  uri: string;
}

function extOf(uri: string): string {
  const m = uri.match(/\.([^./]+)(?:\?.*)?$/);
  return m ? m[1].toLowerCase() : "";
}

function r2Url(uri: string): string {
  return `${API_URL}/data/r2/${uri}`;
}

interface PlotlyJson {
  data: unknown[];
  layout: Record<string, unknown>;
}

function PlotlyJsonArtifact({ uri, height, style, layout }: ResolvedProps) {
  const [fig, setFig] = useState<PlotlyJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFig(null);
    setError(null);
    // no-store: artifacts can be overwritten in place during development;
    // the worker sends max-age=3600 without an ETag, which would otherwise
    // serve stale content for an hour after a re-upload.
    fetch(r2Url(uri), { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((j) => { if (!cancelled) setFig({ data: j.data, layout: j.layout ?? {} }); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [uri]);

  const fallbackStyle: React.CSSProperties = {
    width: "100%",
    height: typeof height === "number" ? `${height}px` : (height ?? "400px"),
    color: "#6b7280",
    padding: "0.75rem",
    ...style,
  };

  if (error) return <div style={{ ...fallbackStyle, color: "#b91c1c" }}>Artifact error: {error}</div>;
  if (!fig) return <div style={fallbackStyle}>Loading {uri}…</div>;

  const mergedLayout = { ...fig.layout, ...(layout ?? {}) };
  return <Plot data={fig.data} layout={mergedLayout} height={height} style={style} />;
}

function ImageArtifact({ uri, height, style }: ResolvedProps) {
  return (
    <img
      src={r2Url(uri)}
      alt={uri}
      style={{ maxWidth: "100%", height: height ?? "auto", display: "block", ...style }}
    />
  );
}

function ArtifactError({ message }: { message: string }) {
  return (
    <div style={{ color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", padding: "0.75rem", borderRadius: 4 }}>
      {message}
    </div>
  );
}

/** Resolve {uri | (exp,run,name) | (run,name) | (name)} + context into a full URI.
 *  Returns either a string URI or an error message describing the validation
 *  failure. Precedence: explicit `uri` always wins. */
function resolveUri(
  props: Pick<Props, "uri" | "exp" | "run" | "name">,
  ctx: { slug: string | null; runIndex: number | null },
): { uri: string } | { error: string } {
  const { uri, exp, run, name } = props;

  // Form 1: explicit full URI (legacy). Wins over any other form.
  if (uri !== undefined) return { uri };

  // Form 3: cross-experiment reference {exp, run, name}.
  if (exp !== undefined) {
    if (run === undefined || name === undefined) {
      return {
        error: `<Artifact exp="${exp}"/> requires both run and name (got run=${run}, name=${name}).`,
      };
    }
    return { uri: `experiments/${exp}/runs/${run}/artifacts/${name}` };
  }

  // Forms 2 / fallback: relative to the surrounding MDX context.
  if (name !== undefined) {
    if (ctx.slug === null) {
      return {
        error: `<Artifact name="${name}"/> requires an MDX experiment context, but none is available.`,
      };
    }
    const r = run !== undefined ? run : (ctx.runIndex ?? 0);
    return { uri: `experiments/${ctx.slug}/runs/${r}/artifacts/${name}` };
  }

  return { error: "<Artifact/> requires one of: uri, name, or {exp, run, name}." };
}

export function Artifact({ uri, exp, run, name, height, style, layout }: Props) {
  const ctx = useMDXContext();
  const resolved = resolveUri({ uri, exp, run, name }, ctx);
  if ("error" in resolved) return <ArtifactError message={resolved.error} />;

  const finalUri = resolved.uri;
  const ext = extOf(finalUri);
  if (ext === "json") return <PlotlyJsonArtifact uri={finalUri} height={height} style={style} layout={layout} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) {
    return <ImageArtifact uri={finalUri} height={height} style={style} />;
  }
  return (
    <ArtifactError
      message={`Unsupported artifact extension: .${ext} (${finalUri})`}
    />
  );
}
