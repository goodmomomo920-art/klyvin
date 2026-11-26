/**
 * Store resolution.
 *
 * A store is reached through its subdomain (`slug.klyvin.app`). Locally we
 * support the same idea through a path-free fallback: the `x-klyvin-store`
 * header or a `?store=` query param, so you can test two stores on one
 * machine without editing your hosts file.
 *
 * Everything downstream receives a `StoreContext` — never a raw slug — so a
 * route can never accidentally query with the wrong tenant.
 */

import type { D1Like } from './db/store-scope';

export interface StoreContext {
  id: string;
  slug: string;
  name: string;
  currency: string;
  locale: 'ar' | 'en';
  themeColor: string;
  logoUrl: string | null;
  tagline: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  /** When false the storefront must hide prices **server-side**. */
  showPrices: boolean;
}

interface StoreRow {
  id: string;
  slug: string;
  name: string;
  currency: string;
  locale: 'ar' | 'en';
  themeColor: string;
  logoUrl: string | null;
  tagline: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  showPrices: number;
}

/** Subdomains that are the platform itself, not a merchant store. */
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'dash', 'dashboard', 'static', 'cdn', 'assets']);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The theme colour is written into a `style` attribute, so it must be a plain
 * hex value. Anything else falls back to the brand orange — a merchant cannot
 * smuggle CSS or HTML through the settings form.
 */
export function safeColor(value: string | null | undefined, fallback = '#ff8a3d'): string {
  return value && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : fallback;
}

/**
 * Extracts the store slug from a hostname.
 *   mystore.klyvin.app  → "mystore"
 *   mystore.localhost   → "mystore"   (local testing)
 *   klyvin.app          → null        (the platform itself)
 *   localhost, 127.0.0.1 → null
 */
export function slugFromHost(host: string | null): string | null {
  if (!host) return null;

  const hostname = host.split(':')[0].toLowerCase();
  if (!hostname || IPV4.test(hostname)) return null;

  const parts = hostname.split('.');
  if (parts.length < 2) return null; // "localhost"

  const candidate = parts[0];
  if (RESERVED.has(candidate)) return null;

  // `mystore.localhost` is a valid local subdomain; anything else needs a
  // real parent domain (`mystore.klyvin.app`), so at least three labels.
  if (parts.length === 2 && parts[1] !== 'localhost') return null;

  return candidate;
}

/** Loads a store plus its settings by slug. */
export async function loadStoreBySlug(db: D1Like, slug: string): Promise<StoreContext | null> {
  if (!slug) return null;

  const row = await db
    .prepare(
      `SELECT st.id, st.slug, st.name,
              COALESCE(s.currency, 'EGP')      AS currency,
              COALESCE(s.locale, 'ar')         AS locale,
              COALESCE(s.theme_color, '#ff8a3d') AS themeColor,
              s.logo_url                       AS logoUrl,
              s.tagline                        AS tagline,
              s.phone, s.whatsapp, s.email, s.address,
              COALESCE(s.show_prices, 1)       AS showPrices
         FROM stores st
         LEFT JOIN store_settings s ON s.store_id = st.id
        WHERE st.slug = ?1 AND st.status = 'active'`,
    )
    .bind(slug)
    .first<StoreRow>();

  if (!row) return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    currency: row.currency,
    locale: row.locale,
    themeColor: safeColor(row.themeColor),
    logoUrl: row.logoUrl,
    tagline: row.tagline,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    address: row.address,
    showPrices: row.showPrices === 1,
  };
}
