import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { searchExperiments, type Experiment } from "../api";
import { StrataLogo } from "../components/StrataLogo";

function parseTags(tags: string): string[] {
  try { return JSON.parse(tags); } catch { return []; }
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

export function GroupListing() {
  const { group } = useParams<{ group: string }>();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!group) return;
    searchExperiments({ group })
      .then((r) => setExperiments(r.experiments))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [group]);

  return (
    <div className="container">
      <header>
        <h1><Link to="/"><StrataLogo />Strata</Link></h1>
      </header>

      <div className="section">
        <h2>Group: {group}</h2>
      </div>

      {loading && <div className="loading">Loading...</div>}
      {error && <div className="error">{error}</div>}

      {experiments.map((exp) => (
        <Link key={exp.experiment_id} to={`/e/${exp.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card">
            <h2>
              {exp.title}
              {" "}
              <span className={`badge ${exp.status}`}>{exp.status}</span>
            </h2>
            <div className="meta">
              {exp.kind} &middot; {exp.created_by} &middot; {timeAgo(exp.created_at)}
              {" "}&middot; <code style={{ fontSize: "0.7rem", color: "#6b7280" }}>{exp.slug}</code>
            </div>
            {exp.intent && <div className="summary">{exp.intent}</div>}
            <div className="tags">
              {parseTags(exp.tags).map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
            </div>
          </div>
        </Link>
      ))}

      {!loading && experiments.length === 0 && (
        <div className="loading">No experiments in this group.</div>
      )}
    </div>
  );
}
