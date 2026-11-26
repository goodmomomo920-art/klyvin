/// <reference types="astro/client" />

type D1Result<T = unknown> = { results: T[]; success: boolean; meta: unknown };

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean; meta: unknown }>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<{ count: number }>;
}

interface R2Bucket {
  put(key: string, value: ArrayBuffer | ReadableStream | string, options?: unknown): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

declare namespace App {
  interface Locals {
    db: D1Database;
    /** R2 bucket; null in environments where media storage is not bound. */
    media: R2Bucket | null;
    /** Resolved from the subdomain. Null on the marketing site. */
    store: import('./lib/store').StoreContext | null;
    /** Logged-in merchant, if the session cookie is valid. */
    merchant: import('./lib/auth/session').MerchantSession | null;
    /** Logged-in customer for `store`, if any. */
    customer: import('./lib/auth/session').CustomerSession | null;
  }
}
