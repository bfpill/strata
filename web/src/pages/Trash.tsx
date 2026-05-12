import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getTrash, restoreExperiment, restoreRun, getAuth, type Experiment, type TrashedRun } from "../api";
import { StrataLogo } from "../components/StrataLogo";

function parseTags(tags: string): string[] {
  try { return JSON.parse(tags); } catch { return []; }
}

export function Trash() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [runs, setRuns] = useState<TrashedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAuthed = !!getAuth();

  useEffect(() => {
    getTrash()
      .then(({ experiments, runs }) => { setExperiments(experiments); setRuns(runs); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const handleRestoreExp = async (slug: string) => {
    await restoreExperiment(slug);
    setExperiments((prev) => prev.filter((e) => e.slug !== slug));
  };

  const handleRestoreRun = async (slug: string, runIndex: number) => {
    await restoreRun(slug, runIndex);
    setRuns((prev) => prev.filter((r) => !(r.experiment_slug === slug && r.run_index === runIndex)));
  };

  return (
    <div className="container strata">
      <header>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1><Link to="/"><StrataLogo />Strata</Link></h1>
          <Link to="/" className="btn-small">&larr; Back to feed</Link>
        </div>
      </header>

      <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Trash</h2>

      {loading && <div className="loading">Loading...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && experiments.length === 0 && runs.length === 0 && (
        <div className="meta" style={{ padding: "2rem", textAlign: "center" }}>Trash is empty.</div>
      )}

      {experiments.length > 0 && (
        <div className="section">
          <h3>Deleted Experiments ({experiments.length})</h3>
          {experiments.map((exp) => (
            <div key={exp.experiment_id} className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: "0.95rem" }}>
                  <Link to={`/e/${exp.slug}`}>{exp.title}</Link>
                </h2>
                <div className="meta">
                  {exp.group && <><span style={{ color: "#2563eb" }}>{exp.group}</span> &middot; </>}
                  {exp.created_by} &middot; <code style={{ fontSize: "0.7rem" }}>{exp.slug}</code>
                </div>
                <div className="tags" style={{ marginTop: "0.25rem" }}>
                  {parseTags(exp.tags).map((t) => <span key={t} className="tag">{t}</span>)}
                </div>
              </div>
              {isAuthed && (
                <button className="btn-small" onClick={() => handleRestoreExp(exp.slug)}>
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div className="section">
          <h3>Deleted Runs ({runs.length})</h3>
          {runs.map((r) => (
            <div key={r.run_id} className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: "0.95rem" }}>
                  <Link to={`/e/${r.experiment_slug}?run=${r.run_index}`}>
                    Run {r.run_index}{r.label ? `: ${r.label}` : ""}
                  </Link>
                </h2>
                <div className="meta">
                  from <Link to={`/e/${r.experiment_slug}`}>{r.experiment_title}</Link>
                  {" "}&middot; <code style={{ fontSize: "0.7rem" }}>{r.experiment_slug}</code>
                </div>
              </div>
              {isAuthed && (
                <button className="btn-small" onClick={() => handleRestoreRun(r.experiment_slug, r.run_index)}>
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isAuthed && !loading && (experiments.length > 0 || runs.length > 0) && (
        <div className="meta" style={{ marginTop: "1rem" }}>
          Sign in on the <Link to="/">feed page</Link> to restore items.
        </div>
      )}
    </div>
  );
}
