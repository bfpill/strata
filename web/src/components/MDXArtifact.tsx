import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { PlotActions } from "./PlotArtifact";

const MDXInline = lazy(() => import("./MDXInline"));

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://strata.timaeus-research-inc.workers.dev";

type Mode = "sandboxed" | "inline";

interface Props {
  uri: string;
  label: string;
  headless?: boolean;
  onActions?: (actions: PlotActions) => void;
  defaultMode?: Mode;
}

function MDXIframe({ uri }: { uri: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const src = `/mdx-frame.html?uri=${encodeURIComponent(uri)}`;

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (!ev.data || typeof ev.data !== "object") return;
      if (ev.data.type !== "strata-mdx-height") return;
      if (ref.current && ev.source !== ref.current.contentWindow) return;
      const h = Number(ev.data.height);
      if (Number.isFinite(h) && h > 50) setHeight(h);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      src={src}
      sandbox="allow-scripts"
      style={{ width: "100%", height: `${height}px`, border: "none", display: "block" }}
      title={uri}
    />
  );
}

export function MDXArtifact({ uri, label, headless, onActions, defaultMode = "sandboxed" }: Props) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    onActions?.({
      openUrls: [{ label: "Open source", url: `${API_URL}/data/r2/${uri}` }],
      download: () => {
        const a = document.createElement("a");
        a.href = `${API_URL}/data/r2/${uri}`;
        a.download = `${label}.mdx`;
        a.click();
      },
    });
  }, [uri, label, onActions]);

  const toggle = (
    <div className="plot-tabs" style={{ marginLeft: "0.5rem" }}>
      <button
        className={`plot-tab ${mode === "sandboxed" ? "active" : ""}`}
        onClick={() => setMode("sandboxed")}
        title="Render inside a sandboxed iframe (no access to parent cookies/DOM)"
      >
        Sandboxed
      </button>
      <button
        className={`plot-tab ${mode === "inline" ? "active" : ""}`}
        onClick={() => setMode("inline")}
        title="Render directly in the page (full DOM access — same origin)"
      >
        Inline
      </button>
    </div>
  );

  const body = mode === "sandboxed" ? (
    <MDXIframe uri={uri} />
  ) : (
    <Suspense fallback={<div style={{ padding: "1rem", color: "#6b7280" }}>Loading MDX runtime…</div>}>
      <MDXInline uri={uri} />
    </Suspense>
  );

  if (headless) {
    return (
      <div>
        <div className="plot-controls" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {toggle}
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
            {mode === "sandboxed" ? "isolated origin · no parent access" : "same origin · full access"}
          </span>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="plot-artifact">
      <div className="plot-header">
        <button
          className="plot-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "+" : "-"}
        </button>
        <span className="plot-label">{label}</span>
        {toggle}
        <div className="plot-actions">
          <a
            href={`${API_URL}/data/r2/${uri}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon"
          >
            Source
          </a>
        </div>
      </div>
      {!collapsed && body}
    </div>
  );
}
