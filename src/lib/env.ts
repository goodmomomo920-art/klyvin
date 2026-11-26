/**
 * Bindings provided by Cloudflare (see wrangler.toml).
 * Secrets never appear here — only binding names.
 */

export interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
}

/** Runtime object injected by the Cloudflare adapter. */
export interface Runtime {
  env: Bindings;
  cf?: unknown;
  caches?: unknown;
}
