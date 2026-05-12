/** Validate an MDX file in two passes:
 *
 *  1. Compile-time: the standard @mdx-js/mdx compile + remark-math + rehype-katex.
 *     Catches syntax errors (e.g. "<1%" parsed as JSX tag opener).
 *
 *  2. Render-time: actually evaluate the compiled component with a stub runtime.
 *     Catches ReferenceError when an MDX inline expression {Identifier,…}
 *     references an undeclared name. The most common case is unwrapped math
 *     notation like "L_{A,0}" or "{s_1, s_2}" in prose — these compile fine
 *     (the JSX expression is syntactically valid) but throw at render. The
 *     local compile-only check missed them.
 *
 *  Usage:
 *    cd aixi/strata/web && node check_mdx.mjs <path-to-mdx>
 */
import { evaluate } from "@mdx-js/mdx";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { readFileSync } from "fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node check_mdx.mjs <path-to-mdx>");
  process.exit(2);
}
const content = readFileSync(path, "utf-8");

// Stub the components our MDX may reference. Renders to null; we only care
// about whether the component function executes without ReferenceError.
//
// Important: do NOT use a Proxy that always returns a stub — MDX checks
// props.components.wrapper to decide whether to wrap in a layout, and a
// stub wrapper would defer _createMdxContent into a JSX element that's
// only evaluated by a real React renderer (so the bug we're hunting
// wouldn't surface). With wrapper undefined the compiled MDX directly
// calls _createMdxContent and any ReferenceError fires synchronously.
const components = {
  Plot: () => null,
  Artifact: () => null,
};

let evaluated;
try {
  evaluated = await evaluate(content, {
    Fragment, jsx, jsxs,
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [rehypeKatex],
  });
} catch (e) {
  console.error(`COMPILE FAIL ${path}:`);
  console.error(`  ${e.message}`);
  if (e.line || e.column) console.error(`  line=${e.line} col=${e.column}`);
  if (e.place) console.error("  place=", JSON.stringify(e.place));
  if (e.reason) console.error("  reason=", e.reason);
  process.exit(1);
}

try {
  // Render the component. Any free identifier in an MDX expression will
  // throw ReferenceError here.
  const MDXContent = evaluated.default;
  MDXContent({ components });
} catch (e) {
  console.error(`RENDER FAIL ${path}:`);
  console.error(`  ${e.message}`);
  if (e.message.includes("is not defined")) {
    const m = e.message.match(/^(\w+) is not defined/);
    const name = m ? m[1] : null;
    console.error(`  Most likely cause: unwrapped math/code in prose. Search for`);
    if (name) {
      console.error(`    bare-brace expressions like "{${name},…}" or "*_{${name},…}"`);
    } else {
      console.error(`    bare-brace expressions in prose`);
    }
    console.error(`  in your MDX. Wrap in $...$ for math, or backticks for code.`);
    if (name) {
      const lines = content.split("\n");
      const re = new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}`);
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) matches.push(i + 1);
      }
      if (matches.length > 0) {
        console.error(`  Candidate line(s): ${matches.join(", ")}`);
        for (const ln of matches.slice(0, 3)) {
          console.error(`    ${ln}: ${lines[ln - 1].trim().slice(0, 200)}`);
        }
      }
    }
  }
  process.exit(1);
}

console.log(`OK: ${path}`);
