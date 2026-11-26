/**
 * Isolation tests for the store scope (AGENTS.md §4).
 *
 * Run with:  npm run test
 *
 * The fake database below is deliberately dumb: it filters rows by the first
 * bound parameter, exactly like D1 would apply `store_id = ?1`. That means
 * these tests fail if the scope ever stops binding the store id first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scopeStore, IsolationError } from './store-scope.ts';
import type { D1Like } from './store-scope.ts';

interface Row {
  store_id: string;
  id: string;
  name: string;
}

const STORE_A = 'store_aaa';
const STORE_B = 'store_bbb';

const ROWS: Row[] = [
  { store_id: STORE_A, id: 'p1', name: 'منتج المتجر أ' },
  { store_id: STORE_A, id: 'p2', name: 'منتج تاني للمتجر أ' },
  { store_id: STORE_B, id: 'p3', name: 'منتج المتجر ب' },
];

/** Records every statement so tests can inspect what actually reached "D1". */
interface Call {
  sql: string;
  params: unknown[];
}

function fakeDb(calls: Call[] = []): D1Like {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });

          return {
            async all<T>() {
              const storeId = params[0];
              const rows = ROWS.filter((row) => row.store_id === storeId);
              return { results: rows as unknown as T[] };
            },
            async first<T>() {
              const storeId = params[0];
              const id = params[1];
              const row = ROWS.find((r) => r.store_id === storeId && r.id === id);
              return (row ?? null) as unknown as T | null;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
}

/* -------------------------------------------------------------------------- */

test('a scoped query sees only its own store', async () => {
  const db = fakeDb();

  const a = await scopeStore(db, STORE_A).all<Row>(
    'SELECT * FROM products WHERE store_id = ?1',
  );
  const b = await scopeStore(db, STORE_B).all<Row>(
    'SELECT * FROM products WHERE store_id = ?1',
  );

  assert.equal(a.length, 2);
  assert.ok(a.every((row) => row.store_id === STORE_A));

  assert.equal(b.length, 1);
  assert.equal(b[0].store_id, STORE_B);

  // The two stores must not share a single row.
  const overlap = a.filter((row) => b.some((other) => other.id === row.id));
  assert.deepEqual(overlap, []);
});

test('asking for another store\'s row by id returns nothing', async () => {
  const db = fakeDb();

  const own = await scopeStore(db, STORE_A).first<Row>(
    'SELECT * FROM products WHERE store_id = ?1 AND id = ?2',
    ['p1'],
  );
  assert.equal(own?.id, 'p1');

  // p3 belongs to store B; store A must not be able to read it even with the
  // correct id, because the store predicate is bound ahead of the caller's.
  const stolen = await scopeStore(db, STORE_A).first<Row>(
    'SELECT * FROM products WHERE store_id = ?1 AND id = ?2',
    ['p3'],
  );
  assert.equal(stolen, null);
});

test('the store id is always the first bound parameter', async () => {
  const calls: Call[] = [];
  const db = fakeDb(calls);

  await scopeStore(db, STORE_A).all('SELECT * FROM products WHERE store_id = ?1 AND id = ?2', ['p9']);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [STORE_A, 'p9']);
});

test('a query without a store predicate is refused before it runs', async () => {
  const calls: Call[] = [];
  const db = fakeDb(calls);

  await assert.rejects(
    () => scopeStore(db, STORE_A).all('SELECT * FROM products'),
    IsolationError,
  );

  assert.equal(calls.length, 0, 'nothing should reach the database');
});

test('a query that forgets to bind ?1 is refused', async () => {
  const calls: Call[] = [];
  const db = fakeDb(calls);

  await assert.rejects(
    () => scopeStore(db, STORE_A).all('SELECT * FROM products WHERE id = ?1'),
    IsolationError,
  );

  assert.equal(calls.length, 0);
});

test('an empty store id cannot create a scope', () => {
  assert.throws(() => scopeStore(fakeDb(), ''), IsolationError);
});
