import { Hono } from "hono";
import type { AppEnv } from "../middleware";

export const dataRouter = new Hono<AppEnv>();

// GET /data/r2/* — raw byte proxy for R2 objects.
// zarrita in the browser hits this to read Zarr chunks directly.
// No auth required (public read), no parsing — just pipes bytes through.
dataRouter.get("/r2/*", async (c) => {
  const key = c.req.path.replace("/data/r2/", "");
  if (!key) return c.text("Missing key", 400);

  // Parse Range header for partial content requests
  const rangeHeader = c.req.header("Range");
  let rangeOpt: { offset: number; length?: number } | undefined;
  if (rangeHeader) {
    const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (m) {
      const offset = parseInt(m[1]);
      rangeOpt = m[2]
        ? { offset, length: parseInt(m[2]) - offset + 1 }
        : { offset };
    }
  }

  const bucket = key.startsWith("experiments/")
    ? c.env.BUCKET
    : c.env.PATTERNING_BUCKET;
  const obj = await bucket.get(key, rangeOpt ? { range: rangeOpt } : undefined);
  if (!obj) return c.text("Not found", 404);

  // Infer Content-Type from key extension (R2 doesn't always set it)
  const ext = key.split(".").pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    html: "text/html",
    json: "application/json",
    png: "image/png",
    pdf: "application/pdf",
    csv: "text/csv",
    mdx: "text/markdown; charset=utf-8",
    md: "text/markdown; charset=utf-8",
  };
  const contentType =
    obj.httpMetadata?.contentType ||
    (ext && contentTypes[ext]) ||
    "application/octet-stream";

  if (rangeOpt && obj.range) {
    const r = obj.range as { offset: number; length: number };
    return new Response(obj.body, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${r.offset}-${r.offset + r.length - 1}/${obj.size}`,
        "Content-Length": String(r.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  return new Response(obj.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": obj.size.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
