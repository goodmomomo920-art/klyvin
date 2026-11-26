/**
 * Dashboard helpers.
 *
 * Every dashboard page needs the same three things: the logged-in merchant,
 * their store, and a scoped database handle. Doing that lookup in one place
 * means a page cannot forget to filter by store.
 */

import type { ScopedDb } from './db/store-scope';
import { scopeStore } from './db/store-scope';

export interface OwnedStore {
  id: string;
  slug: string;
  name: string;
}

export interface DashboardContext {
  merchant: { merchantId: string; email: string; name: string };
  store: OwnedStore;
  /** All tenant queries go through this. */
  db: ScopedDb;
  currency: string;
}

/**
 * Resolves the merchant's store and returns a store-scoped database handle.
 * Returns null when there is no session or no store — callers redirect.
 */
export async function dashboardContext(locals: App.Locals): Promise<DashboardContext | null> {
  const merchant = locals.merchant;
  if (!merchant) return null;

  const raw = locals.db;

  const store = await raw
    .prepare('SELECT id, slug, name FROM stores WHERE merchant_id = ?1 ORDER BY created_at LIMIT 1')
    .bind(merchant.merchantId)
    .first<OwnedStore>();

  if (!store) return null;

  const settings = await raw
    .prepare('SELECT currency FROM store_settings WHERE store_id = ?1')
    .bind(store.id)
    .first<{ currency: string }>();

  return {
    merchant,
    store,
    db: scopeStore(raw, store.id),
    currency: settings?.currency ?? 'EGP',
  };
}
