/**
 * Cart storage.
 *
 * The cart lives in a cookie, not the database: a customer can fill a cart
 * without an account, and no cleanup job is needed for abandoned carts.
 *
 * Two rules that matter:
 *   1. Prices are NEVER stored in the cart. Only product ids and quantities.
 *      Totals are always recomputed from the database, so a customer cannot
 *      edit a cookie to buy a 500 EGP shirt for 1 EGP.
 *   2. A cart is bound to one store. Loading a cart for a different store
 *      returns an empty cart, so items never leak across storefronts.
 */

import type { D1Like } from './db/store-scope';
import { scopeStore } from './db/store-scope';

export const CART_COOKIE = 'klyvin_cart';

export interface CartItem {
  /** Product id. */
  p: string;
  /** Quantity. */
  q: number;
  /** Chosen colour, if the product has colours. */
  c?: string;
  /** Chosen size, if the product has sizes. */
  s?: string;
}

interface CartData {
  /** Store slug the cart belongs to. */
  store: string;
  items: CartItem[];
}

const MAX_QTY = 99;
const MAX_LINES = 40;

export function emptyCart(): CartData {
  return { store: '', items: [] };
}

/** Parses the raw cookie value, tolerating anything malformed. */
export function parseCart(raw: string | undefined, storeSlug: string): CartData {
  if (!raw) return { store: storeSlug, items: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { store: storeSlug, items: [] };
  }

  if (!parsed || typeof parsed !== 'object') return { store: storeSlug, items: [] };

  const data = parsed as Partial<CartData>;

  // A cart from another store is not ours to show.
  if (data.store !== storeSlug) return { store: storeSlug, items: [] };
  if (!Array.isArray(data.items)) return { store: storeSlug, items: [] };

  const items: CartItem[] = [];

  for (const entry of data.items) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Partial<CartItem>;
    if (typeof item.p !== 'string' || !item.p) continue;

    const quantity = Number(item.q);
    if (!Number.isFinite(quantity) || quantity < 1) continue;

    items.push({
      p: item.p,
      q: Math.min(Math.trunc(quantity), MAX_QTY),
      c: typeof item.c === 'string' ? item.c : undefined,
      s: typeof item.s === 'string' ? item.s : undefined,
    });

    if (items.length >= MAX_LINES) break;
  }

  return { store: storeSlug, items };
}

export function serialiseCart(cart: CartData): string {
  return JSON.stringify({ store: cart.store, items: cart.items });
}

/** Adds a line, merging with an identical product+colour+size line. */
export function addToCart(cart: CartData, item: CartItem): CartData {
  const items = [...cart.items];
  const quantity = Math.min(Math.max(1, Math.trunc(item.q)), MAX_QTY);

  const index = items.findIndex((line) => line.p === item.p && line.c === item.c && line.s === item.s);

  if (index >= 0) {
    items[index] = { ...items[index], q: Math.min(items[index].q + quantity, MAX_QTY) };
  } else {
    if (items.length >= MAX_LINES) return cart;
    items.push({ ...item, q: quantity });
  }

  return { store: cart.store, items };
}

export function removeFromCart(cart: CartData, productId: string, color?: string, size?: string): CartData {
  return {
    store: cart.store,
    items: cart.items.filter(
      (line) => !(line.p === productId && line.c === color && line.s === size),
    ),
  };
}

export function setQuantity(
  cart: CartData,
  productId: string,
  quantity: number,
  color?: string,
  size?: string,
): CartData {
  if (quantity < 1) return removeFromCart(cart, productId, color, size);

  return {
    store: cart.store,
    items: cart.items.map((line) =>
      line.p === productId && line.c === color && line.s === size
        ? { ...line, q: Math.min(Math.trunc(quantity), MAX_QTY) }
        : line,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Resolving a cart against the database                                      */
/* -------------------------------------------------------------------------- */

export interface ResolvedLine {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
  color: string | null;
  size: string | null;
  imageUrl: string | null;
  /** False when the product vanished or was hidden — the line is dropped. */
  available: boolean;
  /** Units actually purchasable right now (stock-limited). */
  maxQuantity: number;
}

export interface ResolvedCart {
  lines: ResolvedLine[];
  subtotalCents: number;
  itemCount: number;
}

interface ProductRow {
  id: string;
  name_ar: string;
  price_cents: number;
  stock: number | null;
  is_active: number;
  colors: string | null;
  sizes: string | null;
  image_url: string | null;
}

/**
 * Turns cookie lines into real lines: current name, current price, current
 * stock. Lines whose product no longer exists or is inactive are marked
 * unavailable rather than silently priced at zero.
 */
export async function resolveCart(db: D1Like, storeId: string, cart: CartData): Promise<ResolvedCart> {
  if (cart.items.length === 0) {
    return { lines: [], subtotalCents: 0, itemCount: 0 };
  }

  const scoped = scopeStore(db, storeId);
  const ids = [...new Set(cart.items.map((item) => item.p))];

  const placeholders = ids.map((_, index) => `?${index + 2}`).join(', ');
  const rows = await scoped.all<ProductRow>(
    `SELECT p.id, p.name_ar, p.price_cents, p.stock, p.is_active, p.colors, p.sizes,
            (SELECT url FROM product_images i
              WHERE i.store_id = p.store_id AND i.product_id = p.id
              ORDER BY i.sort_order LIMIT 1) AS image_url
       FROM products p
      WHERE p.store_id = ?1 AND p.id IN (${placeholders})`,
    ids,
  );

  const byId = new Map(rows.map((row) => [row.id, row]));

  const lines: ResolvedLine[] = [];
  let subtotalCents = 0;
  let itemCount = 0;

  for (const item of cart.items) {
    const product = byId.get(item.p);

    if (!product || product.is_active !== 1) {
      lines.push({
        productId: item.p,
        name: 'منتج مش متاح',
        priceCents: 0,
        quantity: item.q,
        color: item.c ?? null,
        size: item.s ?? null,
        imageUrl: null,
        available: false,
        maxQuantity: 0,
      });
      continue;
    }

    const maxQuantity = product.stock === null ? MAX_QTY : Math.min(product.stock, MAX_QTY);

    if (maxQuantity < 1) {
      lines.push({
        productId: product.id,
        name: product.name_ar,
        priceCents: product.price_cents,
        quantity: item.q,
        color: item.c ?? null,
        size: item.s ?? null,
        imageUrl: product.image_url,
        available: false,
        maxQuantity: 0,
      });
      continue;
    }

    const quantity = Math.min(item.q, maxQuantity);
    const lineTotal = product.price_cents * quantity;

    subtotalCents += lineTotal;
    itemCount += quantity;

    lines.push({
      productId: product.id,
      name: product.name_ar,
      priceCents: product.price_cents,
      quantity,
      color: item.c ?? null,
      size: item.s ?? null,
      imageUrl: product.image_url,
      available: true,
      maxQuantity,
    });
  }

  return { lines, subtotalCents, itemCount };
}

/** Splits a comma-separated option list into trimmed, non-empty values. */
export function splitOptions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
