import express from 'express';
import cookieParser from 'cookie-parser';

import db from '../lib/db.js';
import authRoutes from '../routes/auth.js';
import roomRoutes from '../routes/rooms.js';
import tenantRoutes from '../routes/tenants.js';
import paymentRoutes from '../routes/payments.js';
import dashboardRoutes from '../routes/dashboard.js';

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'tenant')),
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    phone TEXT,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_number TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'single' CHECK (type IN ('single', 'shared')),
    price INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'maintenance')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    phone TEXT,
    identity_number TEXT,
    start_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'moved_out')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
    period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_year INTEGER NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    paid_date TEXT,
    payment_method TEXT CHECK (payment_method IN ('cash', 'transfer', 'e-wallet')),
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'late')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tenant_id, period_month, period_year)
  );

  CREATE INDEX IF NOT EXISTS idx_tenants_room ON tenants(room_id);
  CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_payments_period ON payments(period_year, period_month);
`;

let migrated = false;

async function ensureMigrated() {
  if (migrated) return;
  const stmts = MIGRATION_SQL.split(';').filter(s => s.trim());
  for (const stmt of stmts) {
    await db.execute(stmt);
  }
  migrated = true;
}

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  try {
    await ensureMigrated();
    res.json({ ok: true, service: 'kelolakos' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/api/auth', async (req, res, next) => {
  try { await ensureMigrated(); } catch (e) { return res.status(500).json({ error: e.message }); }
  authRoutes(req, res, next);
});

app.use('/api/rooms', async (req, res, next) => {
  try { await ensureMigrated(); } catch (e) { return res.status(500).json({ error: e.message }); }
  roomRoutes(req, res, next);
});

app.use('/api/tenants', async (req, res, next) => {
  try { await ensureMigrated(); } catch (e) { return res.status(500).json({ error: e.message }); }
  tenantRoutes(req, res, next);
});

app.use('/api/payments', async (req, res, next) => {
  try { await ensureMigrated(); } catch (e) { return res.status(500).json({ error: e.message }); }
  paymentRoutes(req, res, next);
});

app.use('/api/dashboard', async (req, res, next) => {
  try { await ensureMigrated(); } catch (e) { return res.status(500).json({ error: e.message }); }
  dashboardRoutes(req, res, next);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

export default app;
