import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { getExperiment } from "../api";

export function LegacyRedirect() {
  const { ulid } = useParams<{ ulid: string }>();
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!ulid) return;
    getExperiment(ulid)
      .then((exp) => setSlug(exp.slug))
      .catch(() => setError(true));
  }, [ulid]);

  if (error) return <div className="container"><div className="error">Experiment not found</div></div>;
  if (slug) return <Navigate to={`/e/${slug}`} replace />;
  return <div className="container"><div className="loading">Redirecting...</div></div>;
}
