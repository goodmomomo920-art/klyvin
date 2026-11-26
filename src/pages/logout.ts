/** Logs the merchant out and clears the cookie. */
import type { APIRoute } from 'astro';
import { destroyMerchantSession, MERCHANT_COOKIE } from '../lib/auth/session';

export const POST: APIRoute = async ({ locals, cookies, redirect }) => {
  const token = cookies.get(MERCHANT_COOKIE)?.value;

  if (token) {
    await destroyMerchantSession(locals.db, token);
  }

  cookies.delete(MERCHANT_COOKIE, { path: '/' });
  return redirect('/login');
};
