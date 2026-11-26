/**
 * Password hashing with the Web Crypto API (available in Workers and Node 20+).
 *
 * Why PBKDF2 and not bcrypt/argon2: those need native binaries, which do not
 * run on Cloudflare Workers' free tier. PBKDF2-HMAC-SHA256 with a high
 * iteration count is the strongest option that works everywhere we deploy.
 *
 * Stored format: `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`
 * The iteration count travels with the hash, so we can raise it later and
 * still verify old passwords.
 */

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const ALGORITHM = 'PBKDF2';
const DIGEST = 'SHA-256';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    ALGORITHM,
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: ALGORITHM, salt: salt as unknown as BufferSource, iterations, hash: DIGEST },
    key,
    KEY_LENGTH * 8,
  );

  return new Uint8Array(bits);
}

/** Hashes a plaintext password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await derive(password, salt, ITERATIONS);

  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Verifies a password against a stored hash.
 * Comparison is constant-time-ish (full loop, no early exit) to avoid leaking
 * how many bytes matched.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]);
    expected = fromBase64(parts[3]);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) return false;

  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
