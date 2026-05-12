import { init, id as instantId } from "@instantdb/admin";
import type { Env } from "./types";

let _db: ReturnType<typeof init> | null = null;

export function getInstantDB(env: Env) {
  if (!env.INSTANT_APP_ID || !env.INSTANT_ADMIN_TOKEN) return null;
  if (!_db) {
    _db = init({
      appId: env.INSTANT_APP_ID,
      adminToken: env.INSTANT_ADMIN_TOKEN,
    });
  }
  return _db;
}

export { instantId as id };
