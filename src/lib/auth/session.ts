/**
 * Session handling for merchants and customers.
 *
 * Rules from AGENTS.md §4:
 *   - The raw token lives only in the browser cookie.
 *   - The database stores only a SHA-256 hash of the token, so a leaked
 *     database dump cannot be replayed as a login.
 *   - A customer session is bound to one store: the store id is part of the
 *     row, and every lookup filters by it. The same person logged into two
 *     stores has two unrelated sessions.
 */

import type { D1Like } from '../db/store-scope';

export const MERCHANT_COOKIE = 'klyvin_merchant';
export const CUSTOMER_COOKIE = 'klyvin_customer';

const SESSION_DAYS = 30;

export interface MerchantSession {
  merchantId: string;
  email: string;
  name: string;
}

export interface CustomerSession {
  customerId: string;
  storeId: string;
  email: string;
  name: string;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function expiry(): string {
  return new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Merchant sessions                                                          */
/* -------------------------------------------------------------------------- */

export async function createMerchantSession(db: D1Like, merchantId: string, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db
    .prepare('INSERT INTO merchant_sessions (token_hash, merchant_id, expires_at) VALUES (?1, ?2, ?3)')
    .bind(tokenHash, merchantId, expiry())
    .run();
}

export async function readMerchantSession(db: D1Like, token: string | undefined): Promise<MerchantSession | null> {
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.merchant_id AS merchantId, m.email AS email, m.name AS name
         FROM merchant_sessions s
         JOIN merchants m ON m.id = s.merchant_id
        WHERE s.token_hash = ?1 AND s.expires_at > datetime('now')`,
    )
    .bind(tokenHash)
    .first<MerchantSession>();

  return row ?? null;
}

export async function destroyMerchantSession(db: D1Like, token: string | undefined): Promise<void> {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db.prepare('DELETE FROM merchant_sessions WHERE token_hash = ?1').bind(tokenHash).run();
}

/* -------------------------------------------------------------------------- */
/* Customer sessions (store-scoped)                                           */
/* -------------------------------------------------------------------------- */

export async function createCustomerSession(
  db: D1Like,
  storeId: string,
  customerId: string,
  token: string,
): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db
    .prepare(
      'INSERT INTO customer_sessions (token_hash, store_id, customer_id, expires_at) VALUES (?1, ?2, ?3, ?4)',
    )
    .bind(tokenHash, storeId, customerId, expiry())
    .run();
}

/**
 * Reads a customer session **only** if it belongs to `storeId`.
 * Passing a token issued by another store returns null — that is the point.
 */
export async function readCustomerSession(
  db: D1Like,
  storeId: string,
  token: string | undefined,
): Promise<CustomerSession | null> {
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT c.id AS customerId, s.store_id AS storeId, c.email AS email, c.name AS name
         FROM customer_sessions s
         JOIN customers c ON c.id = s.customer_id AND c.store_id = s.store_id
        WHERE s.token_hash = ?1 AND s.store_id = ?2 AND s.expires_at > datetime('now')`,
    )
    .bind(tokenHash, storeId)
    .first<CustomerSession>();

  return row ?? null;
}

export async function destroyCustomerSession(db: D1Like, token: string | undefined): Promise<void> {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?1').bind(tokenHash).run();
}

/* -------------------------------------------------------------------------- */
/* Cookie helpers                                                             */
/* -------------------------------------------------------------------------- */

export function sessionCookie(name: string, token: string): string {
  const maxAge = SESSION_DAYS * 86_400;
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
