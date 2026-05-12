import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import {
  listExperiments,
  searchExperiments,
  createExperiment,
  getAuth,
  setAuth,
  clearAuth,
  type Experiment,
  type SortMode,
} from "../api";
import { StrataLogo } from "../components/StrataLogo";
import { getRecentlyViewed, type RecentItem } from "../recentlyViewed";

const PAGE_SIZE = 15;

function parseTags(tags: string): string[] {
  try {
    return JSON.parse(tags);
  } catch {
    return [];
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function readSortFromParams(p: URLSearchParams): SortMode {
  return p.get("sort") === "created" ? "created" : "activity";
}

function AuthSettings() {
  const current = getAuth();
  const [key, setKey] = useState(current?.apiKey || "");
  const [actor, setActor] = useState(current?.actor || "");
  const [saved, setSaved] = useState(!!current);

  if (saved && current) {
    return (
      <div className="auth-bar">
        Signed in as <strong>{current.actor}</strong>
        <button
          onClick={() => {
            clearAuth();
            setSaved(false);
          }}
          className="btn-small"
          style={{ marginLeft: "0.5rem" }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-bar">
      <input
        type="password"
        placeholder="API key (from .env)"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        style={{ width: "200px" }}
        title="STRATA_API_KEY from your .env file"
      />
      <input
        type="text"
        placeholder="Your name"
        value={actor}
        onChange={(e) => setActor(e.target.value)}
        style={{ width: "120px" }}
      />
      <button
        onClick={() => {
          setAuth(key, actor);
          setSaved(true);
        }}
        disabled={!key || !actor}
        className="btn-small"
      >
        Sign in
      </button>
    </div>
  );
}

function CreateExperimentForm({ onCreated }: { onCreated: (slug: string) => void }) {
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  const [intent, setIntent] = useState("");
  const [tags, setTags] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createExperiment({
        title: title.trim(),
        group: group.trim() || undefined,
        intent: intent.trim() || undefined,
        tags: tags.trim() ? tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      });
      onCreated(result.slug);
    } catch (e: any) {
      setError(e.message);
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleCreate} style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "1rem 1.25rem", marginBottom: "1rem" }}>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.75rem" }}>New Experiment</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" autoFocus
          className="search-input" style={{ flex: "none" }} />
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input value={group} onChange={e => setGroup(e.target.value)} placeholder="Group (optional)"
            className="search-input" />
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags (comma-separated)"
            className="search-input" />
        </div>
        <textarea value={intent} onChange={e => setIntent(e.target.value)} placeholder="Intent — what is this experiment for?"
          rows={2} style={{ fontFamily: "inherit", fontSize: "0.85rem", padding: "0.4rem 0.75rem", border: "1px solid #d1d5db", borderRadius: "6px", resize: "vertical" }} />
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button type="submit" disabled={creating || !title.trim()} className="btn">
            {creating ? "Creating..." : "Create"}
          </button>
          {error && <span style={{ color: "#dc2626", fontSize: "0.8rem" }}>{error}</span>}
        </div>
      </div>
    </form>
  );
}

export function Feed() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [hasMore, setHasMore] = useState(true);
  const [recent, setRecent] = useState<RecentItem[]>(() => getRecentlyViewed());
  const offsetRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Bumped on every fetch; stale responses (search-then-scroll-then-search)
  // are dropped if requestIdRef has moved on by the time they resolve.
  const requestIdRef = useRef(0);

  const sort = readSortFromParams(searchParams);
  const authorFilter = searchParams.get("author");
  const currentActor = getAuth()?.actor ?? null;

  // Patch one URL param while keeping all the others. The native pattern
  // — `setSearchParams({key: value})` — wipes everything else.
  const patchParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(updates)) {
            if (v === null || v === "") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const fetchPage = useCallback(
    async (
      q: string | undefined,
      offset: number,
      append: boolean,
      opts: { sort: SortMode; author: string | null },
    ) => {
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const result = q
          ? await searchExperiments({
              q,
              limit: String(PAGE_SIZE),
              offset: String(offset),
              sort: opts.sort,
              ...(opts.author ? { author: opts.author } : {}),
            })
          : await listExperiments(PAGE_SIZE, offset, {
              sort: opts.sort,
              author: opts.author,
            });
        if (requestId !== requestIdRef.current) return;
        setExperiments((prev) =>
          append ? [...prev, ...result.experiments] : result.experiments,
        );
        setHasMore(result.experiments.length === PAGE_SIZE);
        offsetRef.current = offset + result.experiments.length;
      } catch (e: any) {
        if (requestId !== requestIdRef.current) return;
        setError(e.message);
        setHasMore(false);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const q = searchParams.get("q") || "";
    setQuery(q);
    offsetRef.current = 0;
    setHasMore(true);
    fetchPage(q || undefined, 0, false, { sort, author: authorFilter });
  }, [searchParams, fetchPage, sort, authorFilter]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry.isIntersecting) return;
        if (!hasMore || loading || loadingMore) return;
        // Without this guard, a small initial page (e.g. content shorter
        // than the viewport) leaves the sentinel permanently in view,
        // cascading fetches until end-of-feed on first load.
        const root = document.documentElement;
        if (root.scrollHeight <= root.clientHeight) return;
        const q = searchParams.get("q") || "";
        fetchPage(q || undefined, offsetRef.current, true, {
          sort,
          author: authorFilter,
        });
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, searchParams, fetchPage, sort, authorFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    patchParams({ q: query.trim() || null });
  };

  // Refresh the "recently viewed" list when the tab regains focus, since
  // the user may have visited an experiment in another tab.
  useEffect(() => {
    const refresh = () => setRecent(getRecentlyViewed());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  // Author chips are derived from the loaded experiments. We always
  // include the current user (from getAuth()) so "Mine" is reachable
  // even when your work isn't on the first page.
  const authors = useMemo(() => {
    const set = new Set<string>(experiments.map((e) => e.created_by).filter(Boolean));
    if (currentActor) set.add(currentActor);
    return [...set].sort();
  }, [experiments, currentActor]);

  // Cards: prefer to show "modified Xh ago" when sorting by activity,
  // otherwise show the original "created Xh ago".
  const showActivityTimestamp = sort === "activity";

  return (
    <div className="container strata">
      <header>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h1>
            <Link to="/">
              <StrataLogo />
              Strata
            </Link>
          </h1>
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
          >
            <button onClick={() => setShowCreate(s => !s)} className="btn" style={{ fontSize: "0.75rem", padding: "0.25rem 0.7rem" }}>
              {showCreate ? "Cancel" : "+ New"}
            </button>
            <Link to="/catalog" className="btn-small">
              Components
            </Link>
            <Link to="/doc" className="btn-small">
              Docs
            </Link>
            <Link to="/trash" className="btn-small">
              Trash
            </Link>
            <AuthSettings />
          </div>
        </div>
      </header>

      {showCreate && (
        <CreateExperimentForm onCreated={(slug) => navigate(`/e/${slug}`)} />
      )}

      <form onSubmit={handleSearch} style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search experiments..."
            className="search-input"
          />
          <button type="submit" className="btn">
            Search
          </button>
          {searchParams.has("q") && (
            <button
              type="button"
              className="btn-small"
              onClick={() => patchParams({ q: null })}
            >
              Clear
            </button>
          )}
          <div style={{ flex: 1 }} />
          <label
            style={{
              fontSize: "0.8rem",
              color: "#6b7280",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            Sort
            <select
              value={sort}
              onChange={(e) => patchParams({ sort: e.target.value })}
              style={{
                fontSize: "0.85rem",
                padding: "0.25rem 0.4rem",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="activity">Last modified</option>
              <option value="created">Created</option>
            </select>
          </label>
        </div>
      </form>

      {/* Author chips: filter the feed in place by setting ?author=. */}
      {authors.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>Author:</span>
          <button
            type="button"
            onClick={() => patchParams({ author: null })}
            className="tag"
            style={{
              cursor: "pointer",
              border: "none",
              fontWeight: authorFilter === null ? 600 : 400,
              background: authorFilter === null ? "#dbeafe" : undefined,
              color: authorFilter === null ? "#1d4ed8" : undefined,
            }}
          >
            All
          </button>
          {authors.map((a) => {
            const active = authorFilter === a;
            const isMe = a === currentActor;
            return (
              <button
                key={a}
                type="button"
                onClick={() => patchParams({ author: active ? null : a })}
                className="tag"
                title={isMe ? "You" : undefined}
                style={{
                  cursor: "pointer",
                  border: "none",
                  fontWeight: active || isMe ? 600 : 400,
                  background: active ? "#dbeafe" : undefined,
                  color: active ? "#1d4ed8" : undefined,
                }}
              >
                {isMe ? `${a} (you)` : a}
              </button>
            );
          })}
        </div>
      )}

      {/* Recently viewed — compact, single line per entry. localStorage. */}
      {recent.length > 0 && (
        <div
          style={{
            marginBottom: "0.9rem",
            padding: "0.5rem 0.75rem",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            background: "#fafafa",
          }}
        >
          <div
            style={{
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#6b7280",
              marginBottom: "0.35rem",
            }}
          >
            Recently viewed
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {recent.map((r) => (
              <Link
                key={r.slug}
                to={`/e/${r.slug}`}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  fontSize: "0.8rem",
                  padding: "0.1rem 0",
                  color: "inherit",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                <code
                  style={{
                    color: "#2563eb",
                    fontSize: "0.72rem",
                    minWidth: "13rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.slug}
                </code>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.title}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!loading &&
        experiments.length > 0 &&
        (() => {
          const groups = [
            ...new Set(experiments.map((e) => e.group).filter(Boolean)),
          ] as string[];
          if (groups.length === 0) return null;
          return (
            <div
              style={{
                display: "flex",
                gap: "0.4rem",
                marginBottom: "1rem",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                Groups:
              </span>
              {groups.map((g) => (
                <Link
                  key={g}
                  to={`/g/${g}`}
                  className="tag"
                  style={{ textDecoration: "none", cursor: "pointer" }}
                >
                  {g}
                </Link>
              ))}
            </div>
          );
        })()}

      {loading && <div className="loading">Loading experiments...</div>}
      {error && <div className="error">{error}</div>}

      {experiments.map((exp) => (
        <Link
          key={exp.experiment_id}
          to={`/e/${exp.slug}`}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card">
            <h2>
              {exp.title}{" "}
              <span className={`badge ${exp.status}`}>{exp.status}</span>
            </h2>
            <div className="meta">
              {exp.kind}
              {exp.group && (
                <>
                  {" "}
                  &middot; <span style={{ color: "#2563eb" }}>{exp.group}</span>
                </>
              )}{" "}
              &middot; {exp.created_by} &middot;{" "}
              {showActivityTimestamp && exp.last_activity_at &&
              exp.last_activity_at !== exp.created_at ? (
                <span title={`created ${timeAgo(exp.created_at)}`}>
                  modified {timeAgo(exp.last_activity_at)}
                </span>
              ) : (
                <>{timeAgo(exp.created_at)}</>
              )}{" "}
              &middot;{" "}
              <code style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                {exp.slug}
              </code>
            </div>
            <div className="tags">
              {parseTags(exp.tags).map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </Link>
      ))}

      {!loading && experiments.length === 0 && (
        <div className="loading">
          {searchParams.has("q")
            ? "No experiments match your search."
            : "No experiments yet."}
        </div>
      )}

      <div ref={sentinelRef} />

      {loadingMore && <div className="loading">Loading more...</div>}
      {!loading &&
        !loadingMore &&
        !hasMore &&
        experiments.length >= PAGE_SIZE && (
          <div className="loading" style={{ color: "#9ca3af" }}>
            End of feed
          </div>
        )}
    </div>
  );
}
