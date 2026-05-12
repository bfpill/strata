import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  useDeferredValue,
} from "react";
import "highlight.js/styles/atom-one-light.css";
import { useParams, Link, Navigate, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  PlotArtifact,
  PlotGroup,
  PlotSideBySide,
  PlotMultiDropdown,
  type PlotMember,
  type PlotActions,
  prefetchPlots,
} from "../components/PlotArtifact";
import { MDXArtifact } from "../components/MDXArtifact";
import { SynthConfig } from "../components/SynthConfig";
import {
  SimulatorPane,
  type SimulatorPaneParams,
} from "../components/SimulatorPane";
import {
  CodeBrowserPane,
  type CodeBrowserData,
} from "../components/CodeBrowserPane";
import { ZarrTreeView } from "../components/ZarrTreeView";
import { recordView } from "../recentlyViewed";
import { TmSpacePane, type TmSpaceData } from "../components/TmSpacePane";
import {
  SimplexExplorerPane,
  type SimplexExplorerData,
} from "../components/SimplexExplorerPane";
import {
  getExperiment,
  getExperimentRuns,
  getExperimentComments,
  getExperimentArtifacts,
  getExperimentManifest,
  updateNotes,
  addComment,
  updateExperiment,
  deleteExperiment,
  deleteRun,
  getAuth,
  API_URL,
  type Experiment,
  type Run,
  type Comment,
  type Artifact,
} from "../api";
import { LiveDoc } from "../components/core/content/LiveDoc";
import db from "../lib/db";

function ExperimentDoc({ slug }: { slug: string }) {
  const { data, isLoading } = db.useQuery({ draftPosts: { $: { where: { slug } } } });
  const hasDoc = !isLoading && (data?.draftPosts?.length ?? 0) > 0;

  return (
    <div>
      <h4 style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        Document
      </h4>
      {isLoading ? (
        <div className="meta" style={{ fontSize: "0.8rem" }}>Loading...</div>
      ) : hasDoc ? (
        <div style={{ fontSize: "0.85rem" }}>
          <LiveDoc slug={slug} />
        </div>
      ) : (
        <div className="meta" style={{ fontSize: "0.8rem" }}>
          <p style={{ marginBottom: "0.5rem" }}>No linked document yet.</p>
          <p style={{ color: "#9ca3af", lineHeight: 1.5 }}>
            Create a Google Doc with <code style={{ background: "#f3f4f6", padding: "0.1rem 0.3rem", borderRadius: "3px", fontSize: "0.75rem" }}>slug: {slug}</code> at
            the top, then sync it to see live content here with embedded components.
          </p>
        </div>
      )}
    </div>
  );
}

function parseTags(tags: string): string[] {
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}

// --- Subcomponents ---

function NotesEditor({
  slug,
  initial,
  onSaved,
}: {
  slug: string;
  initial: string;
  onSaved: (notes: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateNotes(slug, text);
      onSaved(text);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        style={{
          width: "100%",
          fontFamily: "monospace",
          fontSize: "0.85rem",
          padding: "0.75rem",
          border: "1px solid #d1d5db",
          borderRadius: "6px",
          resize: "vertical",
        }}
        placeholder="Experiment notes (Markdown)"
      />
      <div
        style={{
          marginTop: "0.5rem",
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
        }}
      >
        <button onClick={handleSave} disabled={saving} className="btn">
          {saving ? "Saving..." : "Save notes"}
        </button>
        {error && (
          <span style={{ color: "#dc2626", fontSize: "0.8rem" }}>{error}</span>
        )}
      </div>
    </div>
  );
}

function CommentForm({
  slug,
  onPosted,
}: {
  slug: string;
  onPosted: (c: Comment) => void;
}) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePost = async () => {
    if (!text.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const result = await addComment(slug, text);
      const auth = getAuth();
      onPosted({
        comment_id: result.comment_id,
        experiment_id: "",
        author: auth?.actor || "unknown",
        body_markdown: text,
        created_at: new Date().toISOString(),
        updated_at: null,
        deleted_at: null,
      });
      setText("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{
          width: "100%",
          fontFamily: "inherit",
          fontSize: "0.85rem",
          padding: "0.75rem",
          border: "1px solid #d1d5db",
          borderRadius: "6px",
          resize: "vertical",
        }}
        placeholder="Add a comment (Markdown)"
      />
      <div
        style={{
          marginTop: "0.5rem",
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
        }}
      >
        <button
          onClick={handlePost}
          disabled={posting || !text.trim()}
          className="btn"
        >
          {posting ? "Posting..." : "Post comment"}
        </button>
        {error && (
          <span style={{ color: "#dc2626", fontSize: "0.8rem" }}>{error}</span>
        )}
      </div>
    </div>
  );
}

interface ManifestArtifact {
  label: string;
  uri: string;
  artifact_type: string;
  params?: Record<string, any>;
  /** Per-artifact cache-bust token; falls back to content_hash. */
  updated_at?: string | null;
  content_hash?: string | null;
  [key: string]: any;
}

/** Pick a version token suitable for ?v= cache-busting. */
function artifactVersion(a: { content_hash?: string | null; updated_at?: string | null }): string | undefined {
  return a.content_hash || a.updated_at || undefined;
}

type SidebarTab = "experiment" | "synth" | "notes" | "doc";

// --- Artifact family logic ---

interface ArtifactFamily {
  label: string;
  members: ManifestArtifact[];
}

function buildFamilies(
  manifest: Record<string, any> | null,
  fallbackArtifacts: Artifact[],
): {
  htmlFamilies: ArtifactFamily[];
  otherArtifacts: ManifestArtifact[];
  artifactLayouts: Record<
    string,
    Record<string, string | { mode: string; default?: string }>
  >;
} {
  const manifestArtifacts: ManifestArtifact[] =
    manifest?.outputs?.artifacts || [];
  const useManifest = manifestArtifacts.length > 0;
  const allArtifacts = useManifest
    ? manifestArtifacts
    : fallbackArtifacts.map((a) => ({
        label: a.label || "",
        uri: a.uri,
        artifact_type: a.artifact_type,
      }));
  const artifactLayouts: Record<
    string,
    Record<string, string | { mode: string; default?: string }>
  > = manifest?.outputs?.artifact_layouts || {};

  const viewableTypes = new Set(["plot_html", "plotly_json", "png", "code_browser", "tm_space", "simplex_explorer", "mdx"]);
  const htmlArtifacts = allArtifacts.filter((a) =>
    viewableTypes.has(a.artifact_type),
  );
  const otherArtifacts = allArtifacts.filter(
    (a) => !viewableTypes.has(a.artifact_type),
  );

  const familyMap: Record<string, ManifestArtifact[]> = {};
  for (const a of htmlArtifacts) {
    const key = a.label || a.uri;
    if (!familyMap[key]) familyMap[key] = [];
    familyMap[key].push(a);
  }

  const htmlFamilies = Object.entries(familyMap).map(([label, members]) => ({
    label,
    members,
  }));
  return { htmlFamilies, otherArtifacts, artifactLayouts };
}

function renderFamily(
  family: ArtifactFamily,
  artifactLayouts: Record<
    string,
    Record<string, string | { mode: string; default?: string }>
  >,
  onActions: (actions: PlotActions) => void,
  selectedParams?: Record<string, string>,
  onSelectedParamsChange?: (params: Record<string, string>) => void,
) {
  const { label, members } = family;

  // TM space explorer gets its own full-screen renderer
  const isTmSpace = members.some((m) => m.artifact_type === "tm_space");
  if (isTmSpace) {
    const selected = members[0];
    return (
      <div key={label} style={{ position: "relative", height: "calc(100vh - 110px)" }}>
        <TmSpaceArtifact uri={selected.uri} version={artifactVersion(selected)} />
      </div>
    );
  }

  // Simplex explorer gets its own full-screen renderer
  const isSimplexExplorer = members.some((m) => m.artifact_type === "simplex_explorer");
  if (isSimplexExplorer) {
    const selected = members[0];
    return (
      <div key={label} style={{ position: "relative", height: "calc(100vh - 110px)" }}>
        <SimplexExplorerArtifact uri={selected.uri} version={artifactVersion(selected)} />
      </div>
    );
  }

  // MDX artifacts get their own renderer
  const isMdx = members.some((m) => m.artifact_type === "mdx");
  if (isMdx) {
    const selected = members[0];
    return (
      <MDXArtifact
        key={label}
        uri={selected.uri}
        label={label}
        headless
        onActions={onActions}
      />
    );
  }

  // Code browser families get their own renderer
  const isCodeBrowser = members.some((m) => m.artifact_type === "code_browser");
  if (isCodeBrowser) {
    const layout = artifactLayouts[label] || {};
    const paramKeys =
      Object.keys(layout).length > 0
        ? Object.keys(layout)
        : members[0]?.params
          ? Object.keys(members[0].params)
          : [];

    // Extract default value per param key from layout
    const layoutDefaults: Record<string, string | undefined> = {};
    for (const k of paramKeys) {
      const v = layout[k];
      if (typeof v === "object" && v.default) layoutDefaults[k] = v.default;
    }

    // Resolve selected member: URL params > layout defaults > first member
    const effectiveParams: Record<string, string> = {};
    for (const k of paramKeys) {
      effectiveParams[k] = selectedParams?.[k] ?? layoutDefaults[k] ?? "";
    }
    let selected = members[0];
    if (paramKeys.length > 0) {
      const match = members.find(
        (m) =>
          m.params &&
          paramKeys.every(
            (k) =>
              !effectiveParams[k] ||
              String(m.params![k]) === effectiveParams[k],
          ),
      );
      if (match) selected = match;
    }

    const variantControls =
      members.length > 1 && paramKeys.length > 0 ? (
        <div className="code-browser-params">
          {paramKeys.map((k) => {
            const values = [
              ...new Set(
                members
                  .map((m) => m.params?.[k])
                  .filter((v) => v != null)
                  .map(String),
              ),
            ];
            const current =
              selectedParams?.[k] ??
              layoutDefaults[k] ??
              String(selected.params?.[k] ?? values[0]);
            return (
              <label
                key={k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  fontSize: "0.8rem",
                }}
              >
                {k}:
                <select
                  value={current}
                  onChange={(e) =>
                    onSelectedParamsChange?.({
                      ...selectedParams,
                      [k]: e.target.value,
                    })
                  }
                  style={{ fontSize: "0.8rem", padding: "0.1rem 0.3rem" }}
                >
                  {values.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      ) : null;

    return (
      <div key={label}>
        <CodeBrowserArtifact
          uri={selected.uri}
          version={artifactVersion(selected)}
          headerControls={variantControls}
        />
      </div>
    );
  }

  if (members.length === 1 && !members[0].params) {
    return (
      <PlotArtifact
        key={label}
        uri={members[0].uri}
        html_uri={members[0].html_uri}
        version={artifactVersion(members[0])}
        label={label}
        artifact_type={members[0].artifact_type}
        headless
        onActions={onActions}
      />
    );
  }

  const plotMembers: PlotMember[] = members.map((m) => {
    const paramStr = m.params
      ? Object.entries(m.params)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")
      : m.label;
    return {
      uri: m.uri,
      html_uri: m.html_uri,
      version: artifactVersion(m),
      label: paramStr,
      artifact_type: m.artifact_type,
      params: m.params,
    };
  });

  const layout = artifactLayouts[label] || {};
  const layoutKeys = Object.keys(layout);

  if (layoutKeys.length === 0 && members.length > 1 && members[0].params) {
    // Layout config not loaded yet — infer keys from params to avoid flashing tabs
    const inferredKeys = Object.keys(members[0].params);
    if (inferredKeys.length > 0) {
      return (
        <PlotMultiDropdown
          key={label}
          label={label}
          artifacts={plotMembers}
          paramKeys={inferredKeys}
          headless
          onActions={onActions}
          selectedParams={selectedParams}
          onSelectedParamsChange={onSelectedParamsChange}
        />
      );
    }
  }

  if (layoutKeys.length >= 1) {
    return (
      <PlotMultiDropdown
        key={label}
        label={label}
        artifacts={plotMembers}
        paramKeys={layoutKeys}
        paramModes={layout}
        headless
        onActions={onActions}
        selectedParams={selectedParams}
        onSelectedParamsChange={onSelectedParamsChange}
      />
    );
  }

  // Side-by-side is the only special layout mode that doesn't use PlotMultiDropdown
  const mode = Object.values(layout)[0] || "tabs";
  if (mode === "side-by-side")
    return (
      <PlotSideBySide
        key={label}
        label={label}
        artifacts={plotMembers}
        headless
        onActions={onActions}
      />
    );

  // Fallback: no params, no layout — use tabs
  return (
    <PlotGroup
      key={label}
      label={label}
      artifacts={plotMembers}
      headless
      onActions={onActions}
      selectedParams={selectedParams}
      onSelectedParamsChange={onSelectedParamsChange}
    />
  );
}

// --- Code Browser artifact renderer ---

function descriptorUrl(uri: string, version?: string | null): string {
  const v = version ?? "3";
  return `${API_URL}/data/r2/${uri}?v=${encodeURIComponent(v)}`;
}

function CodeBrowserArtifact({
  uri,
  version,
  headerControls,
}: {
  uri: string;
  version?: string | null;
  headerControls?: React.ReactNode;
}) {
  const [data, setData] = useState<CodeBrowserData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(descriptorUrl(uri, version))
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [uri, version]);

  if (error)
    return (
      <div style={{ padding: "2rem", color: "#dc2626" }}>
        Error loading code browser: {error}
      </div>
    );
  if (!data)
    return (
      <div style={{ padding: "2rem", color: "#6b7280" }}>
        Loading code browser...
      </div>
    );
  return <CodeBrowserPane data={data} headerControls={headerControls} />;
}

function TmSpaceArtifact({ uri, version }: { uri: string; version?: string | null }) {
  const [data, setData] = useState<TmSpaceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(descriptorUrl(uri, version))
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [uri, version]);

  if (error)
    return (
      <div style={{ padding: "2rem", color: "#dc2626" }}>
        Error loading TM space viewer: {error}
      </div>
    );
  if (!data)
    return (
      <div style={{ padding: "2rem", color: "#6b7280" }}>
        Loading TM space viewer...
      </div>
    );
  return <TmSpacePane data={data} />;
}

function SimplexExplorerArtifact({ uri, version }: { uri: string; version?: string | null }) {
  const [data, setData] = useState<SimplexExplorerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(descriptorUrl(uri, version))
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [uri, version]);

  if (error)
    return (
      <div style={{ padding: "2rem", color: "#dc2626" }}>
        Error loading simplex explorer: {error}
      </div>
    );
  if (!data)
    return (
      <div style={{ padding: "2rem", color: "#6b7280" }}>
        Loading simplex explorer...
      </div>
    );
  return <SimplexExplorerPane data={data} />;
}

// --- Sidebar width with localStorage persistence ---

const MAX_ALIVE_FAMILIES = 8;

const SIDEBAR_WIDTH_KEY = "strata_sidebar_width";
const DEFAULT_SIDEBAR_WIDTH = 300;

function getInitialSidebarWidth(): number {
  const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  return stored ? Number(stored) : DEFAULT_SIDEBAR_WIDTH;
}

// --- Main component ---

export function ExperimentDetail() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [exp, setExp] = useState<Experiment | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [allArtifacts, setAllArtifacts] = useState<Artifact[]>([]);
  const [manifests, setManifests] = useState<
    Record<number, Record<string, any>>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [deleted, setDeleted] = useState(false); // redirect after delete

  // Inline editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [editingGroup, setEditingGroup] = useState(false);
  const [editGroupValue, setEditGroupValue] = useState("");
  const [confirmDeleteExp, setConfirmDeleteExp] = useState(false);
  const [confirmDeleteRun, setConfirmDeleteRun] = useState<number | null>(null);

  // Layout state
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("experiment");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Derive mainMode from URL: mode=sim → simulator, otherwise artifacts
  const modeParam = searchParams.get("mode");
  const mainMode =
    modeParam === "sim"
      ? ("simulator" as const)
      : modeParam === "scripts"
        ? ("scripts" as const)
        : modeParam === "data"
          ? ("data" as const)
          : modeParam === "doc"
            ? ("doc" as const)
            : ("artifacts" as const);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [artifactActionsMap, setArtifactActionsMap] = useState<
    Record<string, PlotActions>
  >({});
  // Global LRU of rendered artifact families (keyed as "runIndex:label")
  const [aliveFamilies, setAliveFamilies] = useState<string[]>([]);

  // Resize drag state
  const draggingRef = useRef(false);
  const handleRef = useRef<HTMLDivElement>(null);

  const selectedRunIndex = Number(searchParams.get("run") || 0);
  const selectedArtifactLabel = searchParams.get("artifact") || null;
  const deferredRunIndex = useDeferredValue(selectedRunIndex);
  const isRunTransitioning = deferredRunIndex !== selectedRunIndex;
  const isAuthed = !!getAuth();

  // Extract selection params from URL (all params except run, artifact)
  const selectionParams = useMemo(() => {
    const reserved = new Set(["run", "artifact"]);
    const params: Record<string, string> = {};
    for (const [k, v] of searchParams.entries()) {
      if (!reserved.has(k)) params[k] = v;
    }
    return Object.keys(params).length > 0 ? params : undefined;
  }, [searchParams]);

  // Drag-to-resize sidebar — only visual feedback during drag, apply on drop
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const handle = handleRef.current;
      if (handle) handle.classList.add("dragging");
      // Block iframes from stealing pointer events during drag
      document.body.classList.add("resize-dragging");
      const startX = e.clientX;

      const onMouseMove = (ev: MouseEvent) => {
        if (!draggingRef.current || !handle) return;
        const dx = ev.clientX - startX;
        handle.style.transform = `translateX(${dx}px)`;
      };
      const onMouseUp = (ev: MouseEvent) => {
        draggingRef.current = false;
        document.body.classList.remove("resize-dragging");
        if (handle) {
          handle.classList.remove("dragging");
          handle.style.transform = "";
        }
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        const dx = ev.clientX - startX;
        const newWidth = Math.max(200, Math.min(600, sidebarWidth + dx));
        setSidebarWidth(newWidth);
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(newWidth));
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  // Initial data load
  useEffect(() => {
    if (!slug) return;
    Promise.all([
      getExperiment(slug),
      getExperimentRuns(slug),
      getExperimentComments(slug),
      getExperimentArtifacts(slug),
    ])
      .then(([e, r, c, a]) => {
        setExp(e);
        setRuns(r.runs);
        setComments(c.comments);
        setAllArtifacts(a.artifacts);
        // Push to the "recently viewed" localStorage list so it shows up
        // on the Feed for quick re-access.
        recordView(e.slug, e.title);

        const manifestPromises = r.runs.map((run: Run) =>
          getExperimentManifest(slug, run.run_index)
            .then((m) => [run.run_index, m] as const)
            .catch(() => null),
        );
        Promise.all(manifestPromises).then((results) => {
          const map: Record<number, Record<string, any>> = {};
          for (const r of results) {
            if (r) map[r[0]] = r[1];
          }
          setManifests(map);
          // Prefetch all plot HTML across all runs
          const allItems: { uri: string; version?: string | null }[] = [];
          for (const m of Object.values(map)) {
            const arts: ManifestArtifact[] = m?.outputs?.artifacts || [];
            for (const a of arts) {
              if (a.artifact_type === "plot_html") {
                allItems.push({ uri: a.uri, version: artifactVersion(a) });
              }
            }
          }
          if (allItems.length > 0) prefetchPlots(allItems);
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  // Helper to update URL params, preserving others
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(updates)) {
            if (v === null || v === "") {
              next.delete(k);
            } else {
              next.set(k, v);
            }
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleSelectRun = (runIndex: number) => {
    // Keep artifact label and selection params (dropdown/slider values) across runs
    updateParams({ run: String(runIndex) });
  };

  const handleSelectArtifact = (label: string) => {
    // Clear selection params when switching families
    const clears: Record<string, string | null> = { artifact: label };
    // Remove old selection params
    for (const [k] of searchParams.entries()) {
      if (k !== "run" && k !== "artifact") clears[k] = null;
    }
    updateParams(clears);
  };

  const handleSelectionParamsChange = (params: Record<string, string>) => {
    const updates: Record<string, string | null> = {};
    // Clear old non-reserved params
    for (const [k] of searchParams.entries()) {
      if (k !== "run" && k !== "artifact") updates[k] = null;
    }
    // Set new params
    for (const [k, v] of Object.entries(params)) updates[k] = v;
    updateParams(updates);
  };

  const handleSaveTitle = async () => {
    if (!exp || !editTitleValue.trim()) return;
    await updateExperiment(exp.slug, { title: editTitleValue.trim() });
    setExp({ ...exp, title: editTitleValue.trim() });
    setEditingTitle(false);
  };

  const handleSaveGroup = async () => {
    if (!exp) return;
    const val = editGroupValue.trim() || null;
    await updateExperiment(exp.slug, { group: val });
    setExp({ ...exp, group: val });
    setEditingGroup(false);
  };

  const handleDeleteExperiment = async () => {
    if (!exp) return;
    await deleteExperiment(exp.slug);
    setDeleted(true);
  };

  const handleDeleteRun = async (runIndex: number) => {
    if (!exp) return;
    await deleteRun(exp.slug, runIndex);
    setRuns((prev) => prev.filter((r) => r.run_index !== runIndex));
    setConfirmDeleteRun(null);
    // If we deleted the selected run, switch to first available
    const remaining = runs.filter((r) => r.run_index !== runIndex);
    if (runIndex === selectedRunIndex && remaining.length > 0) {
      handleSelectRun(remaining[0].run_index);
    }
  };

  const handleRestoreExperiment = async () => {
    if (!exp) return;
    await updateExperiment(exp.slug, { status: "active" });
    setExp({ ...exp, status: "active" });
  };

  // LRU alive families — driven by activeFamilyKeyRef, updated during render
  const activeFamilyKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = activeFamilyKeyRef.current;
    if (!key) return;
    setAliveFamilies((prev) => {
      if (prev[0] === key) return prev; // already at front
      const without = prev.filter((k) => k !== key);
      return [key, ...without].slice(0, MAX_ALIVE_FAMILIES);
    });
  });

  // Stable per-family action callbacks (keyed by "runIndex:label")
  const actionsCallbacksRef = useRef<Record<string, (a: PlotActions) => void>>(
    {},
  );
  const getActionsCallback = useCallback(
    (runIdx: number, familyLabel: string) => {
      const key = `${runIdx}:${familyLabel}`;
      if (!actionsCallbacksRef.current[key]) {
        actionsCallbacksRef.current[key] = (a: PlotActions) => {
          setArtifactActionsMap((prev) => ({ ...prev, [key]: a }));
        };
      }
      return actionsCallbacksRef.current[key];
    },
    [],
  );

  // Build families for all runs that have alive families in the LRU
  // Must be above early returns to satisfy Rules of Hooks
  const aliveRunIndices = useMemo(() => {
    const set = new Set<number>();
    for (const key of aliveFamilies) set.add(Number(key.split(":")[0]));
    return set;
  }, [aliveFamilies]);

  // Parse alive family keys into { runIndex, label } for the render loop
  const aliveFamilyEntries = useMemo(
    () =>
      aliveFamilies.map((key) => {
        const colonIdx = key.indexOf(":");
        return {
          runIndex: Number(key.substring(0, colonIdx)),
          label: key.substring(colonIdx + 1),
          key,
        };
      }),
    [aliveFamilies],
  );

  const perRunFamilies = useMemo(() => {
    const result: Record<
      number,
      {
        htmlFamilies: ArtifactFamily[];
        artifactLayouts: Record<string, Record<string, string | { mode: string; default?: string }>>;
      }
    > = {};
    for (const ri of aliveRunIndices) {
      const m = manifests[ri] || null;
      const run = runs.find((r) => r.run_index === ri);
      const arts = run
        ? allArtifacts.filter((a) => a.run_id === run.run_id)
        : allArtifacts;
      const { htmlFamilies, artifactLayouts } = buildFamilies(m, arts);
      result[ri] = { htmlFamilies, artifactLayouts };
    }
    return result;
  }, [aliveRunIndices, manifests, runs, allArtifacts]);

  if (deleted) return <Navigate to="/" replace />;
  if (loading)
    return (
      <div className="container strata">
        <div className="loading">Loading...</div>
      </div>
    );
  if (error || !exp)
    return (
      <div className="container strata">
        <div className="error">{error || "Not found"}</div>
      </div>
    );

  if (slug && exp.slug && slug !== exp.slug) {
    return <Navigate to={`/e/${exp.slug}`} replace />;
  }

  const tags = parseTags(exp.tags);
  // If selected run doesn't exist (deleted), fall back to first available
  const selectedRunExists = runs.some((r) => r.run_index === selectedRunIndex);
  const effectiveRunIndex = selectedRunExists
    ? selectedRunIndex
    : (runs[0]?.run_index ?? 0);
  if (
    !selectedRunExists &&
    runs.length > 0 &&
    effectiveRunIndex !== selectedRunIndex
  ) {
    // Will redirect on next render via the select change
    setTimeout(() => handleSelectRun(effectiveRunIndex), 0);
  }
  const manifest = manifests[effectiveRunIndex] || null;
  const selectedRun = runs.find((r) => r.run_index === effectiveRunIndex);

  const rawIntent = exp.intent || manifest?.intent;
  const intent =
    typeof rawIntent === "string" ? rawIntent : rawIntent?.summary || "";
  const synthProb = (() => {
    const raw = exp.synth_prob_json;
    if (!raw) return manifest?.synth_prob || manifest?.synth_config;
    // Cache parsed JSON to avoid new references on every render
    if ((exp as any)._parsedSynthProb === undefined) {
      (exp as any)._parsedSynthProb = JSON.parse(raw);
    }
    return (exp as any)._parsedSynthProb;
  })();
  const synthName = synthProb?.config?.name;

  const hparams = manifest?.hparams || manifest?.execution?.hparams;
  const sources = manifest?.sources;

  // Build families for selected run (used for tab bar labels + other artifacts)
  const runArtifacts = selectedRun
    ? allArtifacts.filter((a) => a.run_id === selectedRun.run_id)
    : allArtifacts;
  const { htmlFamilies, otherArtifacts } = buildFamilies(
    manifest,
    runArtifacts,
  );

  // Resolve selected artifact label — fall back to first family
  const selectedArtifactFamily =
    selectedArtifactLabel &&
    htmlFamilies.some((f) => f.label === selectedArtifactLabel)
      ? selectedArtifactLabel
      : (htmlFamilies[0]?.label ?? null);

  // Update LRU ref for the effect above
  activeFamilyKeyRef.current = selectedArtifactFamily
    ? `${effectiveRunIndex}:${selectedArtifactFamily}`
    : null;

  return (
    <div className="detail-page strata">
      {/* Tombstoned banner */}
      {exp.status === "tombstoned" && (
        <div
          style={{
            background: "#fef2f2",
            borderBottom: "1px solid #fca5a5",
            padding: "0.4rem 1.5rem",
            fontSize: "0.85rem",
            color: "#991b1b",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          This experiment is in the trash.
          {isAuthed && (
            <button className="btn-small" onClick={handleRestoreExperiment}>
              Restore
            </button>
          )}
        </div>
      )}
      {/* Sticky header */}
      <div className="detail-header">
        <Link to="/" className="back-link">
          &larr; Strata
        </Link>
        {editingTitle ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              flex: 1,
            }}
          >
            <input
              autoFocus
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              style={{
                fontSize: "1.1rem",
                fontWeight: 600,
                border: "1px solid #93c5fd",
                borderRadius: "4px",
                padding: "0.1rem 0.4rem",
                flex: 1,
              }}
            />
            <button className="btn-small" onClick={handleSaveTitle}>
              Save
            </button>
            <button
              className="btn-small"
              onClick={() => setEditingTitle(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <h2
            onClick={
              isAuthed
                ? () => {
                    setEditTitleValue(exp.title);
                    setEditingTitle(true);
                  }
                : undefined
            }
            style={isAuthed ? { cursor: "pointer" } : undefined}
            title={isAuthed ? "Click to edit title" : undefined}
          >
            {exp.title}
          </h2>
        )}
        {runs.length > 0 && (
          <select
            value={effectiveRunIndex}
            onChange={(e) => handleSelectRun(Number(e.target.value))}
            style={{
              fontSize: "0.8rem",
              padding: "0.15rem 0.4rem",
              border: "1px solid #d1d5db",
              borderRadius: "4px",
              color: "#374151",
              background: "white",
            }}
          >
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_index}>
                Run {r.run_index}
                {r.label ? `: ${r.label}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="detail-body">
        {/* Sidebar collapse toggle */}
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          {sidebarCollapsed ? "\u25B6" : "\u25C0"}
        </button>

        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <div className="detail-sidebar" style={{ width: sidebarWidth }}>
              <div className="sidebar-tabs">
                <button
                  className={`sidebar-tab ${sidebarTab === "experiment" ? "active" : ""}`}
                  onClick={() => setSidebarTab("experiment")}
                >
                  Experiment
                </button>
                <button
                  className={`sidebar-tab ${sidebarTab === "synth" ? "active" : ""}`}
                  onClick={() => setSidebarTab("synth")}
                >
                  Synth
                </button>
                <button
                  className={`sidebar-tab ${sidebarTab === "notes" ? "active" : ""}`}
                  onClick={() => setSidebarTab("notes")}
                >
                  Notes
                </button>
                <button
                  className={`sidebar-tab ${sidebarTab === "doc" ? "active" : ""}`}
                  onClick={() => setSidebarTab("doc")}
                >
                  Doc
                </button>
              </div>

              <div className="sidebar-content">
                {/* Experiment tab */}
                {sidebarTab === "experiment" && (
                  <>
                    {/* Info section */}
                    <div style={{ marginBottom: "0.75rem" }}>
                      <h4
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "#374151",
                          marginBottom: "0.25rem",
                        }}
                      >
                        Info
                      </h4>
                      <table className="hparams-table">
                        <tbody>
                          <tr>
                            <td>Group</td>
                            <td>
                              {editingGroup ? (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "0.3rem",
                                    alignItems: "center",
                                  }}
                                >
                                  <input
                                    autoFocus
                                    value={editGroupValue}
                                    onChange={(e) =>
                                      setEditGroupValue(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleSaveGroup();
                                      if (e.key === "Escape")
                                        setEditingGroup(false);
                                    }}
                                    placeholder="group name (empty = none)"
                                    style={{
                                      fontSize: "0.8rem",
                                      border: "1px solid #93c5fd",
                                      borderRadius: "3px",
                                      padding: "0.1rem 0.3rem",
                                      width: "120px",
                                    }}
                                  />
                                  <button
                                    className="btn-small"
                                    onClick={handleSaveGroup}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn-small"
                                    onClick={() => setEditingGroup(false)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <span
                                  onClick={
                                    isAuthed
                                      ? () => {
                                          setEditGroupValue(exp.group || "");
                                          setEditingGroup(true);
                                        }
                                      : undefined
                                  }
                                  style={
                                    isAuthed ? { cursor: "pointer" } : undefined
                                  }
                                  title={
                                    isAuthed ? "Click to edit group" : undefined
                                  }
                                >
                                  {exp.group ? (
                                    <Link to={`/g/${exp.group}`}>
                                      {exp.group}
                                    </Link>
                                  ) : (
                                    <span style={{ color: "#9ca3af" }}>
                                      none
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                          </tr>
                          <tr>
                            <td>Slug</td>
                            <td>
                              <code style={{ fontSize: "0.7rem" }}>
                                {exp.slug}
                              </code>
                            </td>
                          </tr>
                          <tr>
                            <td>Created</td>
                            <td>
                              {exp.created_by} &middot;{" "}
                              {new Date(exp.created_at).toLocaleDateString()}
                            </td>
                          </tr>
                          {intent && (
                            <tr>
                              <td>Intent</td>
                              <td style={{ fontStyle: "italic" }}>{intent}</td>
                            </tr>
                          )}
                          {synthName && (
                            <tr>
                              <td>Synth</td>
                              <td>{synthName}</td>
                            </tr>
                          )}
                          {tags.length > 0 && (
                            <tr>
                              <td>Tags</td>
                              <td>
                                {tags.map((t) => (
                                  <span key={t} className="tag">
                                    {t}
                                  </span>
                                ))}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Runs */}
                    {runs.length > 0 && (
                      <>
                        <h4
                          style={{
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: "#374151",
                            marginBottom: "0.25rem",
                          }}
                        >
                          Runs ({runs.length})
                        </h4>
                        <ul className="run-list">
                          {runs.map((r) => (
                            <li
                              key={r.run_id}
                              className={`run-item ${r.run_index === effectiveRunIndex ? "selected" : ""}`}
                              onClick={() => handleSelectRun(r.run_index)}
                            >
                              <span className="run-marker">
                                {r.run_index === effectiveRunIndex
                                  ? "\u25B6"
                                  : ""}
                              </span>
                              Run {r.run_index}
                              {r.label && (
                                <span className="run-label">{r.label}</span>
                              )}
                              {isAuthed && confirmDeleteRun === r.run_index ? (
                                <span
                                  className="run-label"
                                  style={{ display: "flex", gap: "0.2rem" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    className="btn-small"
                                    style={{
                                      color: "#dc2626",
                                      borderColor: "#fca5a5",
                                    }}
                                    onClick={() => handleDeleteRun(r.run_index)}
                                  >
                                    Delete
                                  </button>
                                  <button
                                    className="btn-small"
                                    onClick={() => setConfirmDeleteRun(null)}
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : isAuthed ? (
                                <button
                                  className="btn-small"
                                  style={{
                                    marginLeft: "auto",
                                    opacity: 0.4,
                                    padding: "0.1rem 0.3rem",
                                    fontSize: "0.65rem",
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteRun(r.run_index);
                                  }}
                                  title="Delete run"
                                >
                                  &times;
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {runs.length === 0 && (
                      <div className="meta" style={{ fontSize: "0.8rem" }}>
                        No runs.
                      </div>
                    )}

                    {/* Hparams */}
                    {hparams && Object.keys(hparams).length > 0 && (
                      <div style={{ marginBottom: "0.75rem" }}>
                        <h4
                          style={{
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: "#374151",
                            marginBottom: "0.25rem",
                          }}
                        >
                          Hyperparameters
                        </h4>
                        <table className="hparams-table">
                          <tbody>
                            {Object.entries(hparams).map(([k, v]) => (
                              <tr key={k}>
                                <td>{k}</td>
                                <td>
                                  <code style={{ fontSize: "0.75rem" }}>
                                    {JSON.stringify(v)}
                                  </code>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Sources */}
                    {sources && Object.keys(sources).length > 0 && (
                      <div style={{ marginBottom: "0.75rem" }}>
                        <h4
                          style={{
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            color: "#374151",
                            marginBottom: "0.25rem",
                          }}
                        >
                          Sources
                        </h4>
                        <table className="hparams-table">
                          <tbody>
                            {Object.entries(sources).map(([label, uri]) => (
                              <tr key={label}>
                                <td>{label}</td>
                                <td>
                                  <code style={{ fontSize: "0.7rem" }}>
                                    {typeof uri === "string"
                                      ? uri
                                      : JSON.stringify(uri)}
                                  </code>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* R2 Storage */}
                    <div style={{ marginBottom: "0.75rem" }}>
                      <h4
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "#374151",
                          marginBottom: "0.25rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        Storage
                        <a
                          href={`https://dash.cloudflare.com/d00038c6596061598646a3726dd77a60/r2/default/buckets/aixi?prefix=experiments%2F${exp.slug}%2F`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: "0.7rem", fontWeight: 400 }}
                        >
                          Browse in R2
                        </a>
                      </h4>
                      <table className="hparams-table">
                        <tbody>
                          <tr>
                            <td>Experiment</td>
                            <td>
                              <code style={{ fontSize: "0.7rem" }}>
                                s3://aixi/experiments/{exp.slug}/
                              </code>
                            </td>
                          </tr>
                          {effectiveRunIndex != null && (
                            <tr>
                              <td>Run {effectiveRunIndex}</td>
                              <td>
                                <code style={{ fontSize: "0.7rem" }}>
                                  s3://aixi/experiments/{exp.slug}/runs/
                                  {effectiveRunIndex}/zarr/
                                </code>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <div
                        className="meta"
                        style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}
                      >
                        s3:// requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
                        R2_SECRET_ACCESS_KEY in .env
                      </div>
                    </div>

                    {/* Manifest */}
                    {manifest && (
                      <div style={{ marginBottom: "0.75rem" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            marginBottom: "0.25rem",
                          }}
                        >
                          <h4
                            style={{
                              fontSize: "0.8rem",
                              fontWeight: 600,
                              color: "#374151",
                              margin: 0,
                            }}
                          >
                            Manifest
                          </h4>
                          <button
                            className="btn-small"
                            style={{ fontSize: "0.65rem" }}
                            onClick={() => {
                              navigator.clipboard.writeText(
                                JSON.stringify(manifest, null, 2),
                              );
                            }}
                            title="Copy manifest JSON"
                          >
                            Copy
                          </button>
                        </div>
                        <details>
                          <summary
                            style={{
                              cursor: "pointer",
                              fontWeight: 500,
                              fontSize: "0.8rem",
                              color: "#6b7280",
                            }}
                          >
                            Show JSON
                          </summary>
                          <pre
                            style={{ marginTop: "0.25rem", fontSize: "0.7rem" }}
                          >
                            <code>{JSON.stringify(manifest, null, 2)}</code>
                          </pre>
                        </details>
                      </div>
                    )}

                    {/* API Reference */}
                    <div style={{ marginBottom: "0.75rem" }}>
                      <h4
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "#374151",
                          marginBottom: "0.25rem",
                        }}
                      >
                        API
                      </h4>
                      <div
                        style={{
                          fontSize: "0.7rem",
                          fontFamily: "'SF Mono', Monaco, monospace",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.2rem",
                        }}
                      >
                        <div>
                          <span style={{ color: "#16a34a" }}>GET</span>{" "}
                          <a
                            href={`${API_URL}/experiments/${exp.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            /experiments/{exp.slug}
                          </a>
                        </div>
                        <div>
                          <span style={{ color: "#16a34a" }}>GET</span>{" "}
                          <a
                            href={`${API_URL}/experiments/${exp.slug}/runs`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            /experiments/{exp.slug}/runs
                          </a>
                        </div>
                        <div>
                          <span style={{ color: "#16a34a" }}>GET</span>{" "}
                          <a
                            href={`${API_URL}/experiments/${exp.slug}/manifest?run=${effectiveRunIndex}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            /experiments/{exp.slug}/manifest?run=
                            {effectiveRunIndex}
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Delete experiment */}
                    {isAuthed && exp.status !== "tombstoned" && (
                      <div
                        style={{
                          marginTop: "1.5rem",
                          paddingTop: "0.75rem",
                          borderTop: "1px solid #f3f4f6",
                        }}
                      >
                        {confirmDeleteExp ? (
                          <div style={{ fontSize: "0.8rem" }}>
                            <span style={{ color: "#dc2626" }}>
                              Delete this experiment? This moves it to trash.
                            </span>
                            <div
                              style={{
                                display: "flex",
                                gap: "0.3rem",
                                marginTop: "0.3rem",
                              }}
                            >
                              <button
                                className="btn-small"
                                style={{
                                  color: "#dc2626",
                                  borderColor: "#fca5a5",
                                }}
                                onClick={handleDeleteExperiment}
                              >
                                Yes, delete
                              </button>
                              <button
                                className="btn-small"
                                onClick={() => setConfirmDeleteExp(false)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="btn-small"
                            style={{ color: "#dc2626" }}
                            onClick={() => setConfirmDeleteExp(true)}
                          >
                            Delete experiment
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Synth tab */}
                {sidebarTab === "synth" && (
                  <>
                    {synthProb?.model && synthProb?.task && synthProb?.codes ? (
                      <SynthConfig
                        synth_config={synthProb.config || {}}
                        model={synthProb.model}
                        task={synthProb.task}
                        codes={synthProb.codes}
                      />
                    ) : (
                      <div className="meta" style={{ fontSize: "0.8rem" }}>
                        No synthesis problem data.
                      </div>
                    )}
                  </>
                )}

                {/* Notes tab */}
                {sidebarTab === "notes" && (
                  <>
                    <div style={{ marginBottom: "1rem" }}>
                      <h4
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "#374151",
                          marginBottom: "0.25rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        Notes
                        {isAuthed && !editingNotes && (
                          <button
                            onClick={() => setEditingNotes(true)}
                            className="btn-small"
                          >
                            Edit
                          </button>
                        )}
                      </h4>
                      {editingNotes ? (
                        <NotesEditor
                          slug={exp.slug}
                          initial={exp.notes_markdown || ""}
                          onSaved={(notes) => {
                            setExp({ ...exp, notes_markdown: notes });
                            setEditingNotes(false);
                          }}
                        />
                      ) : exp.notes_markdown ? (
                        <>
                          <div
                            className="notes"
                            style={{ fontSize: "0.85rem" }}
                          >
                            <ReactMarkdown>{exp.notes_markdown}</ReactMarkdown>
                          </div>
                          {exp.notes_updated_by && (
                            <div
                              className="meta"
                              style={{
                                marginTop: "0.25rem",
                                fontSize: "0.75rem",
                              }}
                            >
                              Updated by {exp.notes_updated_by} &middot;{" "}
                              {new Date(exp.notes_updated_at!).toLocaleString()}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="meta" style={{ fontSize: "0.8rem" }}>
                          No notes yet.
                          {isAuthed && (
                            <button
                              onClick={() => setEditingNotes(true)}
                              className="btn-small"
                              style={{ marginLeft: "0.5rem" }}
                            >
                              Add notes
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Comments */}
                    <div>
                      <h4
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: "#374151",
                          marginBottom: "0.25rem",
                        }}
                      >
                        Comments ({comments.length})
                      </h4>
                      {comments.map((c) => (
                        <div
                          key={c.comment_id}
                          className="comment"
                          style={{ fontSize: "0.85rem" }}
                        >
                          <div className="comment-meta">
                            {c.author} &middot;{" "}
                            {new Date(c.created_at).toLocaleString()}
                          </div>
                          <ReactMarkdown>{c.body_markdown}</ReactMarkdown>
                        </div>
                      ))}
                      {comments.length === 0 && (
                        <div className="meta" style={{ fontSize: "0.8rem" }}>
                          No comments yet.
                        </div>
                      )}
                      {isAuthed && (
                        <CommentForm
                          slug={exp.slug}
                          onPosted={(c) => setComments([...comments, c])}
                        />
                      )}
                      {!isAuthed && (
                        <div
                          className="meta"
                          style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}
                        >
                          Set API key in <Link to="/">settings</Link> to post
                          comments.
                        </div>
                      )}
                    </div>
                  </>
                )}
                {sidebarTab === "doc" && (
                  <ExperimentDoc slug={exp.slug} />
                )}
              </div>
            </div>
            <div
              className="resize-handle"
              ref={handleRef}
              onMouseDown={onMouseDown}
            />
          </>
        )}

        {/* Main content area */}
        <div className="detail-main">
          {/* Mode toggle: Artifacts / Scripts / Simulator */}
          <div className="main-mode-tabs">
            <button
              className={`main-mode-tab ${mainMode === "artifacts" ? "active" : ""}`}
              onClick={() => updateParams({ mode: null })}
            >
              Artifacts
            </button>
            <button
              className={`main-mode-tab ${mainMode === "scripts" ? "active" : ""}`}
              onClick={() => updateParams({ mode: "scripts" })}
            >
              Scripts
            </button>
            <button
              className={`main-mode-tab ${mainMode === "data" ? "active" : ""}`}
              onClick={() => updateParams({ mode: "data" })}
            >
              Data
            </button>
            {synthProb && (
              <button
                className={`main-mode-tab ${mainMode === "simulator" ? "active" : ""}`}
                onClick={() => updateParams({ mode: "sim" })}
              >
                Simulator
              </button>
            )}
            <button
              className={`main-mode-tab ${mainMode === "doc" ? "active" : ""}`}
              onClick={() => updateParams({ mode: "doc" })}
            >
              Doc
            </button>
          </div>

          {/* Artifacts mode */}
          {mainMode === "artifacts" && (
            <>
              {htmlFamilies.length > 0 && (
                <div className="artifact-tabs">
                  {htmlFamilies.length <= 10 ? (
                    htmlFamilies.map((f) => (
                      <button
                        key={f.label}
                        className={`artifact-tab ${f.label === selectedArtifactFamily ? "active" : ""}`}
                        onClick={() => handleSelectArtifact(f.label)}
                      >
                        {f.label}
                      </button>
                    ))
                  ) : (
                    <div className="artifact-selector">
                      <select
                        value={selectedArtifactFamily ?? ""}
                        onChange={(e) => handleSelectArtifact(e.target.value)}
                        className="artifact-dropdown"
                      >
                        {htmlFamilies.map((f) => (
                          <option key={f.label} value={f.label}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="artifact-nav-btn"
                        disabled={!selectedArtifactFamily || htmlFamilies.findIndex(f => f.label === selectedArtifactFamily) <= 0}
                        onClick={() => {
                          const idx = htmlFamilies.findIndex(f => f.label === selectedArtifactFamily);
                          if (idx > 0) handleSelectArtifact(htmlFamilies[idx - 1].label);
                        }}
                      >◀</button>
                      <span className="artifact-nav-pos">
                        {(htmlFamilies.findIndex(f => f.label === selectedArtifactFamily) + 1)} / {htmlFamilies.length}
                      </span>
                      <button
                        className="artifact-nav-btn"
                        disabled={!selectedArtifactFamily || htmlFamilies.findIndex(f => f.label === selectedArtifactFamily) >= htmlFamilies.length - 1}
                        onClick={() => {
                          const idx = htmlFamilies.findIndex(f => f.label === selectedArtifactFamily);
                          if (idx < htmlFamilies.length - 1) handleSelectArtifact(htmlFamilies[idx + 1].label);
                        }}
                      >▶</button>
                    </div>
                  )}
                  {(() => {
                    const actions = selectedArtifactFamily
                      ? artifactActionsMap[
                          `${effectiveRunIndex}:${selectedArtifactFamily}`
                        ]
                      : null;
                    if (!actions) return null;
                    return (
                      <div
                        className="plot-actions"
                        style={{
                          marginLeft: "auto",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          padding: "0.25rem 0",
                        }}
                      >
                        {actions.openUrls.map((o, i) => (
                          <a
                            key={i}
                            href={o.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-icon"
                          >
                            {o.label}
                          </a>
                        ))}
                        <button className="btn-icon" onClick={actions.download}>
                          HTML
                        </button>
                        {actions.downloadJson && (
                          <button
                            className="btn-icon"
                            onClick={actions.downloadJson}
                          >
                            JSON
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
              <div
                className="artifact-content"
                style={{ position: "relative" }}
              >
                {/* Spinner overlay while run is transitioning */}
                {isRunTransitioning && (
                  <div className="artifact-loading-overlay">
                    <div className="artifact-spinner" />
                  </div>
                )}
                {/* Mount artifact containers from global family LRU */}
                {aliveFamilyEntries.map(({ runIndex: ri, label: fl, key }) => {
                  const runData = perRunFamilies[ri];
                  if (!runData) return null;
                  const family = runData.htmlFamilies.find(
                    (f) => f.label === fl,
                  );
                  if (!family) return null;
                  const isActive =
                    ri === deferredRunIndex && fl === selectedArtifactFamily;
                  return (
                    <div
                      key={key}
                      style={{ display: isActive ? "block" : "none" }}
                    >
                      {renderFamily(
                        family,
                        runData.artifactLayouts,
                        getActionsCallback(ri, fl),
                        isActive ? selectionParams : undefined,
                        isActive ? handleSelectionParamsChange : undefined,
                      )}
                    </div>
                  );
                })}
                {htmlFamilies.length === 0 && otherArtifacts.length === 0 && (
                  <div
                    className="meta"
                    style={{ padding: "2rem", textAlign: "center" }}
                  >
                    No artifacts for this run.
                  </div>
                )}
                {otherArtifacts.length > 0 && (
                  <div style={{ marginTop: "1rem" }}>
                    <h4
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: "#374151",
                        marginBottom: "0.5rem",
                      }}
                    >
                      Other Artifacts
                    </h4>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Label</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {otherArtifacts.map((a, i) => (
                          <tr key={i}>
                            <td>{a.label || a.uri}</td>
                            <td>
                              <code>{a.artifact_type}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Scripts mode */}
          {mainMode === "scripts" && (
            <div
              className="artifact-content"
              style={{ padding: "1rem", overflow: "auto" }}
            >
              <ScriptsPanel manifest={manifest} apiUrl={API_URL} />
            </div>
          )}

          {/* Data mode */}
          {mainMode === "data" && selectedRun && (
            <div className="artifact-content" style={{ overflow: "auto" }}>
              <ZarrTreeView
                zarrUri={`experiments/${exp.slug}/runs/${selectedRun.run_index}/zarr/`}
              />
            </div>
          )}

          {/* Simulator mode */}
          {mainMode === "simulator" && synthProb && (
            <div className="artifact-content">
              <SimulatorPane
                model={synthProb.model}
                task={synthProb.task}
                codes={synthProb.codes}
                params={{
                  code: searchParams.get("sim_code") || undefined,
                  input: searchParams.get("sim_input") || undefined,
                  steps: searchParams.get("sim_steps") || undefined,
                  plot: searchParams.get("sim_plot") || undefined,
                  sens: searchParams.get("sim_sens") || undefined,
                }}
                onParamsChange={(p: SimulatorPaneParams) => {
                  const updates: Record<string, string | null> = {
                    mode: "sim",
                  };
                  updates.sim_code = p.code || null;
                  updates.sim_input = p.input || null;
                  updates.sim_steps = p.steps || null;
                  updates.sim_plot = p.plot === "loss" ? null : p.plot || null;
                  updates.sim_sens = p.sens || null;
                  updateParams(updates);
                }}
              />
            </div>
          )}
          {mainMode === "doc" && (
            <div className="artifact-content" style={{ padding: "1.5rem" }}>
              <ExperimentDoc slug={exp.slug} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Scripts Panel ---

function ScriptsPanel({
  manifest,
  apiUrl,
}: {
  manifest: Record<string, any> | null;
  apiUrl: string;
}) {
  const [scripts, setScripts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const invocations: any[] = manifest?.invocations || [];
  const legacyScript = manifest?.provenance?.script;

  const fetchScript = async (idx: number, uri: string) => {
    if (scripts[idx]) return;
    setLoading(idx);
    try {
      const resp = await fetch(`${apiUrl}/data/r2/${uri}`);
      const text = await resp.text();
      setScripts((prev) => ({ ...prev, [idx]: text }));
    } catch {
      setScripts((prev) => ({ ...prev, [idx]: "// Failed to load script" }));
    }
    setLoading(null);
  };

  useEffect(() => {
    if (
      invocations.length > 0 &&
      invocations[selectedIdx]?.script_uri &&
      !scripts[selectedIdx]
    ) {
      fetchScript(selectedIdx, invocations[selectedIdx].script_uri);
    }
  }, [invocations.length, selectedIdx]);

  if (invocations.length === 0 && !legacyScript) {
    return (
      <div style={{ color: "#9ca3af", fontStyle: "italic" }}>
        No scripts recorded for this run.
      </div>
    );
  }

  // Legacy: single embedded script
  if (invocations.length === 0 && legacyScript) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        {legacyScript.path && (
          <div style={{ marginBottom: "0.5rem" }}>
            <code style={{ fontSize: "0.7rem", color: "#6b7280" }}>
              {legacyScript.path}
            </code>
          </div>
        )}
        <HighlightedCode code={legacyScript.content} />
      </div>
    );
  }

  const inv = invocations[selectedIdx];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Header: dropdown + metadata */}
      <div style={{ marginBottom: "0.75rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "0.5rem",
          }}
        >
          {invocations.length > 1 ? (
            <select
              value={selectedIdx}
              onChange={(e) => setSelectedIdx(Number(e.target.value))}
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                padding: "0.2rem 0.4rem",
              }}
            >
              {invocations.map((inv: any, idx: number) => (
                <option key={idx} value={idx}>
                  Invocation {idx} —{" "}
                  {inv.timestamp
                    ? new Date(inv.timestamp).toLocaleString()
                    : ""}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>
              Invocation 0
            </span>
          )}
          {inv?.timestamp && invocations.length <= 1 && (
            <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              {new Date(inv.timestamp).toLocaleString()}
            </span>
          )}
          {inv?.commit && (
            <code style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
              {inv.branch ? `${inv.branch}@` : ""}
              {inv.commit.slice(0, 8)}
              {inv.dirty ? "*" : ""}
            </code>
          )}
        </div>
        {inv?.argv && (
          <div style={{ marginBottom: "0.25rem" }}>
            <code
              style={{
                fontSize: "0.75rem",
                background: "#f3f4f6",
                padding: "0.25rem 0.5rem",
                borderRadius: "4px",
              }}
            >
              {inv.argv.join(" ")}
            </code>
          </div>
        )}
        {inv?.script_path && (
          <div>
            <code style={{ fontSize: "0.7rem", color: "#6b7280" }}>
              {inv.script_path}
            </code>
          </div>
        )}
      </div>

      {/* Script content */}
      {inv?.script_uri && !scripts[selectedIdx] && loading !== selectedIdx && (
        <button
          onClick={() => fetchScript(selectedIdx, inv.script_uri)}
          style={{
            fontSize: "0.8rem",
            cursor: "pointer",
            background: "#f3f4f6",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            padding: "0.25rem 0.75rem",
            alignSelf: "flex-start",
          }}
        >
          Show source
        </button>
      )}
      {loading === selectedIdx && (
        <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>Loading...</span>
      )}
      {scripts[selectedIdx] && <HighlightedCode code={scripts[selectedIdx]} />}
    </div>
  );
}

function HighlightedCode({ code }: { code: string }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) {
      import("highlight.js/lib/core").then((hljs) =>
        import("highlight.js/lib/languages/python").then((python) => {
          hljs.default.registerLanguage("python", python.default);
          if (ref.current) hljs.default.highlightElement(ref.current);
        }),
      );
    }
  }, [code]);

  return (
    <pre
      style={{
        borderRadius: "6px",
        overflow: "auto",
        flex: 1,
        minHeight: 0,
        margin: 0,
      }}
    >
      <code
        ref={ref}
        className="language-python"
        style={{ fontSize: "0.8rem", lineHeight: 1.5 }}
      >
        {code}
      </code>
    </pre>
  );
}
