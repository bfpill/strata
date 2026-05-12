import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./middleware";
import { experimentsRouter } from "./routes/experiments";
import { searchRouter } from "./routes/search";
import { dataRouter } from "./routes/data";

const app = new Hono<AppEnv>();

// CORS for frontend
app.use("*", cors({ origin: "*" }));

// Health check
app.get("/health", (c) => c.json({ status: "ok", service: "strata" }));

// Public read routes
app.route("/experiments", experimentsRouter);
app.route("/search", searchRouter);
app.route("/data", dataRouter);

// Fallback
app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
