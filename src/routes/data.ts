import { Hono } from "hono";
import type { AppEnv } from "../middleware";

export const dataRouter = new Hono<AppEnv>();

// GET /data/r2/* — raw byte proxy for R2 objects.
// zarrita in the browser hits this to read Zarr chunks directly.
// No auth required (public read), no parsing — just pipes bytes through.
dataRouter.get("/r2/*", async (c) => {
  const key = c.req.path.replace("/data/r2/", "");
  if (!key) return c.text("Missing key", 400);

  const obj = await c.env.BUCKET.get(key);
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

  return new Response(obj.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": obj.size.toString(),
      "Cache-Control": "public, max-age=3600",
    },
  });
});
