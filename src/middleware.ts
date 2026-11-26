/**
 * Request middleware — the one place that decides "which store is this?".
 *
 * Order of resolution:
 *   1. `/s/<slug>/...` path   (works everywhere, including localhost)
 *   2. Subdomain (`mystore.klyvin.app`, `mystore.localhost`)
 *   3. `?store=` query param   (local dev convenience)
 *   4. `x-klyvin-store` header (local dev convenience)
 *
 * Everything after this file can trust `locals.store`.
 */

import { defineMiddleware } from 'astro:middleware';
import { loadStoreBySlug, slugFromHost } from './lib/store';
import {
  readMerchantSession,
  readCustomerSession,
  MERCHANT_COOKIE,
  CUSTOMER_COOKIE,
} from './lib/auth/session';
import type { Runtime } from './lib/env';

/** `/s/my-store/products` → `my-store` */
function slugFromPath(pathname: string): string | null {
  const match = /^\/s\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { locals, cookies, request, url } = context;

  const runtime = (locals as unknown as { runtime?: Runtime }).runtime;
  const db = runtime?.env?.DB;
  const media = runtime?.env?.MEDIA;

  locals.store = null;
  locals.merchant = null;
  locals.customer = null;

  if (!db) {
    return new Response(
      'Database binding "DB" is missing. Run `npm run dev` (wrangler proxy) or check wrangler.toml.',
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  locals.db = db;
  locals.media = media ?? null;

  // --- 1. Which store? -----------------------------------------------------
  const slug =
    slugFromPath(url.pathname) ??
    slugFromHost(request.headers.get('host')) ??
    url.searchParams.get('store') ??
    request.headers.get('x-klyvin-store');

  if (slug) {
    locals.store = await loadStoreBySlug(db, slug);
  }

  // --- 2. Who is logged in? ------------------------------------------------
  locals.merchant = await readMerchantSession(db, cookies.get(MERCHANT_COOKIE)?.value);

  if (locals.store) {
    locals.customer = await readCustomerSession(db, locals.store.id, cookies.get(CUSTOMER_COOKIE)?.value);
  }

  return next();
});
