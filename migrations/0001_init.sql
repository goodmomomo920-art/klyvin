-- ============================================================================
-- 0001_init.sql — Klyvin initial schema
--
-- ISOLATION RULE (see AGENTS.md §4):
--   Every store-scoped table carries `store_id`, and every query against it
--   must go through src/lib/db/store-scope.ts which injects `store_id`.
--   No ad-hoc query on tenant data is allowed.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Merchants (platform-level accounts). One merchant owns one or more stores.
-- ---------------------------------------------------------------------------
CREATE TABLE merchants (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_merchants_email ON merchants (email);

-- ---------------------------------------------------------------------------
-- Stores (tenants). `slug` is the subdomain.
-- ---------------------------------------------------------------------------
CREATE TABLE stores (
  id             TEXT PRIMARY KEY,
  merchant_id    TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'suspended', 'draft')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stores_merchant ON stores (merchant_id);
CREATE INDEX idx_stores_slug ON stores (slug);

-- ---------------------------------------------------------------------------
-- Store settings: branding, contact info, locale. One row per store.
-- ---------------------------------------------------------------------------
CREATE TABLE store_settings (
  store_id        TEXT PRIMARY KEY REFERENCES stores (id) ON DELETE CASCADE,
  logo_url        TEXT,
  tagline         TEXT,
  phone           TEXT,
  whatsapp        TEXT,
  email           TEXT,
  address         TEXT,
  currency        TEXT NOT NULL DEFAULT 'EGP',
  locale          TEXT NOT NULL DEFAULT 'ar'
                  CHECK (locale IN ('ar', 'en')),
  theme_color     TEXT NOT NULL DEFAULT '#ff8a3d',
  show_prices     INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name_ar     TEXT NOT NULL,
  name_en     TEXT,
  slug        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, slug)
);

CREATE INDEX idx_categories_store ON categories (store_id, sort_order);

-- ---------------------------------------------------------------------------
-- Products. `kind` separates physical goods from digital downloads.
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  category_id   TEXT REFERENCES categories (id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'physical'
                CHECK (kind IN ('physical', 'digital')),
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  description   TEXT,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  compare_cents INTEGER CHECK (compare_cents >= 0),
  stock         INTEGER CHECK (stock >= 0),
  colors        TEXT,
  sizes         TEXT,
  file_key      TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_products_store ON products (store_id, is_active);
CREATE INDEX idx_products_category ON products (store_id, category_id);

CREATE TABLE product_images (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_product_images_product ON product_images (store_id, product_id, sort_order);

-- ---------------------------------------------------------------------------
-- Order statuses — merchants define and rename their own.
-- ---------------------------------------------------------------------------
CREATE TABLE order_statuses (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name_ar    TEXT NOT NULL,
  slug       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'open'
             CHECK (kind IN ('open', 'paid', 'shipped', 'done', 'cancelled')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE (store_id, slug)
);

CREATE INDEX idx_order_statuses_store ON order_statuses (store_id, sort_order);

-- ---------------------------------------------------------------------------
-- Customers — one account per store (PRD §3.5). Same person in two stores
-- gets two independent rows.
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, email)
);

CREATE INDEX idx_customers_store ON customers (store_id);

-- ---------------------------------------------------------------------------
-- Sessions. Store-scoped for customers, merchant-wide for the dashboard.
-- ---------------------------------------------------------------------------
CREATE TABLE merchant_sessions (
  token_hash TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants (id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE customer_sessions (
  token_hash  TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_customer_sessions_store ON customer_sessions (store_id);

-- ---------------------------------------------------------------------------
-- Shipping zones — merchant-defined areas and prices.
-- ---------------------------------------------------------------------------
CREATE TABLE shipping_zones (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  fee_cents   INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_shipping_zones_store ON shipping_zones (store_id, sort_order);

-- ---------------------------------------------------------------------------
-- Payment methods — enabled/disabled per store.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_methods (
  store_id   TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  method     TEXT NOT NULL CHECK (method IN ('cash', 'pos', 'vodafone_cash', 'instapay')),
  is_enabled INTEGER NOT NULL DEFAULT 0,
  instructions TEXT,
  PRIMARY KEY (store_id, method)
);

-- ---------------------------------------------------------------------------
-- Orders + items. All amounts in integer cents to avoid float drift.
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id               TEXT PRIMARY KEY,
  store_id         TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  -- Null for guest checkout; a customer account is optional in the MVP.
  customer_id      TEXT REFERENCES customers (id) ON DELETE SET NULL,
  status_id        TEXT NOT NULL REFERENCES order_statuses (id) ON DELETE RESTRICT,
  reference        TEXT NOT NULL,
  subtotal_cents   INTEGER NOT NULL DEFAULT 0,
  shipping_cents   INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0,
  payment_method   TEXT NOT NULL DEFAULT 'cash',
  payment_status   TEXT NOT NULL DEFAULT 'pending'
                   CHECK (payment_status IN ('pending', 'confirmed', 'failed')),
  shipping_name    TEXT,
  shipping_phone   TEXT,
  shipping_address TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, reference)
);

CREATE INDEX idx_orders_store ON orders (store_id, created_at DESC);
CREATE INDEX idx_orders_customer ON orders (store_id, customer_id, created_at DESC);

CREATE TABLE order_items (
  id             TEXT PRIMARY KEY,
  store_id       TEXT NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  order_id       TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id     TEXT REFERENCES products (id) ON DELETE SET NULL,
  name_snapshot  TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  color          TEXT,
  size           TEXT
);

CREATE INDEX idx_order_items_order ON order_items (store_id, order_id);
