import { Router } from 'express';
import db from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

const VALID_STATUS = ['unpaid', 'paid', 'late'];
const VALID_METHODS = ['cash', 'transfer', 'e-wallet'];

function authCheck(req, res) {
  const user = requireAuth(req, res);
  return user;
}

router.get('/', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { month, year, status, tenant_id, room_id } = req.query;
  const clauses = [];
  const args = [];

  if (month) { clauses.push('p.period_month = ?'); args.push(month); }
  if (year) { clauses.push('p.period_year = ?'); args.push(year); }
  if (status && VALID_STATUS.includes(status)) { clauses.push('p.status = ?'); args.push(status); }
  if (tenant_id) { clauses.push('p.tenant_id = ?'); args.push(tenant_id); }
  if (room_id) { clauses.push('p.room_id = ?'); args.push(room_id); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.execute({
    sql: `SELECT p.*, t.name AS tenant_name, r.room_number
      FROM payments p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN rooms r ON r.id = p.room_id
      ${where}
      ORDER BY p.period_year DESC, p.period_month DESC, r.room_number COLLATE NOCASE ASC`,
    args,
  });
  res.json({ payments: rows });
});

router.post('/', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { tenant_id, period_month, period_year, amount, paid_date, payment_method, status, notes } = req.body || {};

  if (!tenant_id || !period_month || !period_year) {
    return res.status(400).json({ error: 'Penghuni, bulan, dan tahun wajib diisi.' });
  }
  if (payment_method && !VALID_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: 'Metode pembayaran tidak valid.' });
  }
  if (status && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid.' });
  }

  const { rows: tenants } = await db.execute({
    sql: 'SELECT * FROM tenants WHERE id = ?',
    args: [tenant_id],
  });
  if (tenants.length === 0) return res.status(400).json({ error: 'Penghuni tidak ditemukan.' });
  const tenant = tenants[0];

  let room = null;
  if (tenant.room_id) {
    const { rows: rooms } = await db.execute({
      sql: 'SELECT * FROM rooms WHERE id = ?',
      args: [tenant.room_id],
    });
    room = rooms[0] || null;
  }
  const finalAmount = amount != null ? Number.parseInt(amount, 10) || 0 : room?.price || 0;

  const { rows: dups } = await db.execute({
    sql: 'SELECT id FROM payments WHERE tenant_id = ? AND period_month = ? AND period_year = ?',
    args: [tenant_id, period_month, period_year],
  });
  if (dups.length > 0) {
    return res.status(409).json({ error: 'Tagihan untuk periode ini sudah ada.' });
  }

  try {
    const result = await db.execute({
      sql: `INSERT INTO payments (tenant_id, room_id, period_month, period_year, amount, paid_date, payment_method, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        tenant_id,
        tenant.room_id || null,
        Number.parseInt(period_month, 10),
        Number.parseInt(period_year, 10),
        finalAmount,
        paid_date || null,
        payment_method || null,
        status || 'unpaid',
        notes || null,
      ],
    });
    const { rows } = await db.execute({
      sql: 'SELECT * FROM payments WHERE id = ?',
      args: [Number(result.lastInsertRowid)],
    });
    res.status(201).json({ payment: rows[0] });
  } catch {
    res.status(400).json({ error: 'Gagal menyimpan pembayaran.' });
  }
});

router.post('/generate', async (req, res) => {
  if (!authCheck(req, res)) return;

  const now = new Date();
  const month = Number.parseInt(req.body?.month, 10) || now.getMonth() + 1;
  const year = Number.parseInt(req.body?.year, 10) || now.getFullYear();

  const { rows: tenants } = await db.execute({
    sql: `SELECT t.*, r.price AS room_price FROM tenants t
      LEFT JOIN rooms r ON r.id = t.room_id
      WHERE t.status = 'active'`,
    args: [],
  });

  let created = 0;
  let skipped = 0;

  for (const t of tenants) {
    const { rows: exists } = await db.execute({
      sql: 'SELECT id FROM payments WHERE tenant_id = ? AND period_month = ? AND period_year = ?',
      args: [t.id, month, year],
    });
    if (exists.length > 0) {
      skipped++;
      continue;
    }
    await db.execute({
      sql: `INSERT INTO payments (tenant_id, room_id, period_month, period_year, amount, status)
        VALUES (?, ?, ?, ?, ?, 'unpaid')`,
      args: [t.id, t.room_id || null, month, year, t.room_price || 0],
    });
    created++;
  }

  res.json({ created, skipped, month, year });
});

router.put('/:id', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows } = await db.execute({
    sql: 'SELECT * FROM payments WHERE id = ?',
    args: [req.params.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Pembayaran tidak ditemukan.' });
  const payment = rows[0];

  const { amount, paid_date, payment_method, status, notes } = req.body || {};
  if (payment_method && !VALID_METHODS.includes(payment_method)) {
    return res.status(400).json({ error: 'Metode pembayaran tidak valid.' });
  }
  if (status && !VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid.' });
  }

  let finalPaidDate = paid_date !== undefined ? paid_date : payment.paid_date;
  if (status === 'paid' && !finalPaidDate) {
    finalPaidDate = new Date().toISOString().slice(0, 10);
  }

  await db.execute({
    sql: `UPDATE payments SET amount = ?, paid_date = ?, payment_method = ?, status = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?`,
    args: [
      amount != null ? Number.parseInt(amount, 10) || 0 : payment.amount,
      finalPaidDate || null,
      payment_method !== undefined ? payment_method || null : payment.payment_method,
      status || payment.status,
      notes !== undefined ? notes : payment.notes,
      req.params.id,
    ],
  });

  const { rows: updated } = await db.execute({
    sql: 'SELECT * FROM payments WHERE id = ?',
    args: [req.params.id],
  });
  res.json({ payment: updated[0] });
});

router.post('/:id/pay', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows } = await db.execute({
    sql: 'SELECT * FROM payments WHERE id = ?',
    args: [req.params.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Pembayaran tidak ditemukan.' });

  const method =
    req.body?.payment_method && VALID_METHODS.includes(req.body.payment_method)
      ? req.body.payment_method
      : 'cash';
  const paidDate = req.body?.paid_date || new Date().toISOString().slice(0, 10);

  await db.execute({
    sql: `UPDATE payments SET status = 'paid', paid_date = ?, payment_method = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [paidDate, method, req.params.id],
  });
  const { rows: updated } = await db.execute({
    sql: 'SELECT * FROM payments WHERE id = ?',
    args: [req.params.id],
  });
  res.json({ payment: updated[0] });
});

router.delete('/:id', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows } = await db.execute({
    sql: 'SELECT * FROM payments WHERE id = ?',
    args: [req.params.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Pembayaran tidak ditemukan.' });
  await db.execute({ sql: 'DELETE FROM payments WHERE id = ?', args: [req.params.id] });
  res.json({ ok: true });
});

export default router;
