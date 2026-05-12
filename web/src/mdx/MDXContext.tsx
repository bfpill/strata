import { createContext, useContext } from "react";

/** Context describing the experiment + run that a piece of MDX is being
 *  rendered for. Lets MDX components like <Artifact/> resolve relative
 *  references (e.g. {run, name} or {exp, run, name}) to a full R2 URI.
 *
 *  Both fields may be null when the MDX is rendered outside an experiment
 *  context (e.g. a standalone preview); components that need them should
 *  check and fall back gracefully.
 */
export interface MDXContextValue {
  slug: string | null;
  runIndex: number | null;
}

export const MDXContext = createContext<MDXContextValue>({
  slug: null,
  runIndex: null,
});

export function useMDXContext(): MDXContextValue {
  return useContext(MDXContext);
}

/** Parse an artifact R2 URI of the form
 *      experiments/<slug>/runs/<n>/artifacts/<name>
 *  and return {slug, runIndex}. Returns nulls if the URI doesn't match.
 */
export function parseExperimentUri(uri: string): MDXContextValue {
  const m = uri.match(/^experiments\/([^/]+)\/runs\/(\d+)\//);
  if (!m) return { slug: null, runIndex: null };
  return { slug: m[1], runIndex: Number(m[2]) };
}
