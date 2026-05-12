import { useEffect, useMemo, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { evaluate } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Plot } from "./Plot";
import { Artifact } from "./Artifact";
import { MDXContext, parseExperimentUri } from "./MDXContext";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://strata.timaeus-research-inc.workers.dev";

function r2Url(uri: string): string {
  return `${API_URL}/data/r2/${uri}`;
}

const components = { Plot, Artifact };

interface Props {
  uri: string;
  onReady?: () => void;
  /** Override for the surrounding experiment context. If omitted, we parse
   *  it out of `uri`, expecting the standard
   *      experiments/<slug>/runs/<n>/artifacts/<name>.mdx
   *  layout. */
  slug?: string | null;
  runIndex?: number | null;
}

export function MDXRenderer({ uri, onReady, slug, runIndex }: Props) {
  const [Content, setContent] = useState<React.ComponentType<{
    components?: Record<string, unknown>;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);

    (async () => {
      try {
        // no-store: MDX source can be overwritten in place during dev;
        // the worker's max-age=3600 would otherwise pin a stale copy.
        const res = await fetch(r2Url(uri), { cache: "no-store" });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
        const source = await res.text();

        const mod = await evaluate(source, {
          Fragment,
          jsx: jsx as unknown as Parameters<typeof evaluate>[1]["jsx"],
          jsxs: jsxs as unknown as Parameters<typeof evaluate>[1]["jsxs"],
          remarkPlugins: [remarkGfm, remarkMath],
          rehypePlugins: [rehypeKatex],
        });

        if (cancelled) return;
        setContent(() => mod.default as React.ComponentType<{
          components?: Record<string, unknown>;
        }>);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [uri]);

  useEffect(() => {
    if (Content || error) onReady?.();
  }, [Content, error, onReady]);

  const ctxValue = useMemo(() => {
    if (slug !== undefined || runIndex !== undefined) {
      return {
        slug: slug ?? null,
        runIndex: runIndex ?? null,
      };
    }
    return parseExperimentUri(uri);
  }, [uri, slug, runIndex]);

  if (error) return <div className="mdx-error">MDX error: {error}</div>;
  if (!Content) return <div className="mdx-loading">Compiling MDX…</div>;
  return (
    <MDXContext.Provider value={ctxValue}>
      <Content components={components} />
    </MDXContext.Provider>
  );
}
