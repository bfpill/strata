// Cloudflare bindings available to all routes
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  STRATA_API_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  INSTANT_APP_ID: string;
  INSTANT_ADMIN_TOKEN: string;
  ENVIRONMENT: string;
}
