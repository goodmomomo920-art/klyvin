/** Random, URL-safe identifiers. */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Generates a prefixed, collision-resistant id such as `prd_9f2k1m8x`.
 * Prefixed ids make logs and database rows readable.
 */
export function newId(prefix: string, length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }

  return `${prefix}_${out}`;
}

/** Opaque session token (hex, 32 bytes). Never stored raw — only its hash. */
export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Turns a store name into a URL-safe subdomain candidate. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u0621-\u064a-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
