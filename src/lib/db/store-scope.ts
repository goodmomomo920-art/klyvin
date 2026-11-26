/**
 * The single gateway to tenant data.
 *
 * ISOLATION RULE (AGENTS.md §4): no query may touch store-owned data without
 * a store scope. Callers cannot write a raw query — they get a `ScopedDb`
 * bound to exactly one store, and every statement is forced to carry the
 * store id.
 *
 * How it works:
 *   - The scope writes `?1` into the SQL for you and always binds the store id
 *     as parameter 1, so your own parameters start at `?2`.
 *   - Every statement is checked for a `store_id` reference and for `?1`.
 *     A statement that forgets either throws before reaching D1.
 *
 * Tests in `src/lib/db/store-scope.test.ts` prove two stores cannot see each
 * other's rows.
 */

export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<{ success: boolean; meta?: unknown }>;
    };
  };
}

/** Raised when a query would run without a store boundary. */
export class IsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsolationError';
  }
}

const STORE_MARKER = 'store_id';
const STORE_PARAM = '?1';

function assertScoped(sql: string): void {
  const normalised = sql.replace(/\s+/g, ' ').toLowerCase();

  if (!normalised.includes(STORE_MARKER)) {
    throw new IsolationError(
      `Query is missing a "store_id" predicate. Every store-owned statement ` +
        `must filter by store. Statement: ${sql}`,
    );
  }

  if (!normalised.includes(STORE_PARAM)) {
    throw new IsolationError(
      `Query must bind the store id as ${STORE_PARAM}. Your own parameters ` +
        `start at ?2. Statement: ${sql}`,
    );
  }
}

export interface ScopedDb {
  /** The store this scope is locked to. */
  readonly storeId: string;
  /** SELECT returning many rows. Bind store id as `?1`, yours from `?2`. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** SELECT returning one row (or null). */
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  /** INSERT / UPDATE / DELETE. Returns the D1 result. */
  run(sql: string, params?: unknown[]): Promise<{ success: boolean; meta?: unknown }>;
  /** INSERT ... RETURNING, handy for created rows. */
  returning<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
}

/**
 * Binds a database handle to one store.
 *
 * @example
 *   const db = scopeStore(env.DB, store.id);
 *   const products = await db.all<Product>(
 *     'SELECT * FROM products WHERE store_id = ?1 AND is_active = 1',
 *   );
 *   const one = await db.first<Product>(
 *     'SELECT * FROM products WHERE store_id = ?1 AND id = ?2',
 *     [id],
 *   );
 */
export function scopeStore(db: D1Like, storeId: string): ScopedDb {
  if (!storeId) {
    throw new IsolationError('scopeStore() requires a non-empty store id.');
  }

  const bind = (sql: string, params: unknown[] = []) => {
    assertScoped(sql);
    return db.prepare(sql).bind(storeId, ...params);
  };

  return {
    storeId,

    async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const { results } = await bind(sql, params).all<T>();
      return results ?? [];
    },

    async first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
      return await bind(sql, params).first<T>();
    },

    async run(sql: string, params?: unknown[]): Promise<{ success: boolean; meta?: unknown }> {
      return await bind(sql, params).run();
    },

    async returning<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
      return await bind(sql, params).first<T>();
    },
  };
}
