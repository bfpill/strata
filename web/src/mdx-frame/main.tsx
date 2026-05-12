import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import { MDXRenderer } from "../mdx/MDXRenderer";

const params = new URLSearchParams(window.location.search);
const uri = params.get("uri");

const root = createRoot(document.getElementById("root")!);

function postHeight() {
  const h = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
  );
  window.parent?.postMessage({ type: "strata-mdx-height", height: h }, "*");
}

if (!uri) {
  root.render(<div className="mdx-error">Missing ?uri= query parameter.</div>);
} else {
  root.render(
    <StrictMode>
      <div className="mdx-content">
        <MDXRenderer uri={uri} onReady={postHeight} />
      </div>
    </StrictMode>,
  );
}

const observer = new ResizeObserver(postHeight);
observer.observe(document.body);
window.addEventListener("load", postHeight);
