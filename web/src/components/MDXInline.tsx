import "katex/dist/katex.min.css";
import "../mdx/mdx-content.css";
import { MDXRenderer } from "../mdx/MDXRenderer";

export default function MDXInline({ uri }: { uri: string }) {
  return (
    <div className="mdx-inline mdx-content" style={{ padding: "1rem 1.25rem" }}>
      <MDXRenderer uri={uri} />
    </div>
  );
}
