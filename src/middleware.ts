import { MiddlewareHandler } from "hono";
import type { Env } from "./types";

export type AppEnv = { Bindings: Env; Variables: { actor: string } };

/**
 * Auth middleware: checks Bearer token and X-Actor header on write endpoints.
 * Public read endpoints skip this.
 */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (
  c,
  next,
) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  if (token !== c.env.STRATA_API_KEY) {
    return c.json({ error: "Invalid API key" }, 403);
  }

  const actor = c.req.header("X-Actor");
  if (!actor) {
    return c.json({ error: "Missing X-Actor header (required for attribution)" }, 400);
  }

  // Stash actor on context for downstream handlers
  c.set("actor", actor);
  await next();
};
