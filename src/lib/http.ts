/** Small helpers for form handling and redirects. */

export function str(value: FormDataEntryValue | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function bool(value: FormDataEntryValue | null | undefined): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

export function int(value: FormDataEntryValue | null | undefined, fallback = 0): number {
  const n = Number(str(value));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Redirects back to a form with a single error message. */
export function backWithError(path: string, message: string): Response {
  const url = new URL(path, 'http://placeholder');
  url.searchParams.set('error', message);
  return new Response(null, {
    status: 303,
    headers: { location: url.pathname + url.search },
  });
}

export function redirect(path: string, status = 303): Response {
  return new Response(null, { status, headers: { location: path } });
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
