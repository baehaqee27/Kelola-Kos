import { Router } from 'express';
import db from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

const VALID_TYPES = ['single', 'shared'];
const VALID_STATUS = ['available', 'occupied', 'maintenance'];

function authCheck(req, res) {
  const user = requireAuth(req, res);
  return user;
}

router.get('/', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { status, q } = req.query;
  const clauses = [];
  const args = [];

  if (status && VALID_STATUS.includes(status)) {
    clauses.push('r.status = ?');
    args.push(status);
  }
  if (q) {
    clauses.push('(r.room_number LIKE ? OR r.notes LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.execute({
    sql: `SELECT r.*,
            (SELECT COUNT(*) FROM tenants t WHERE t.room_id = r.id AND t.status = 'active') AS active_tenants
     FROM rooms r ${where}
     ORDER BY r.room_number COLLATE NOCASE ASC`,
    args,
  });
  res.json({ rooms: rows });
});

router.get('/:id', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows } = await db.execute({
    sql: 'SELECT * FROM rooms WHERE id = ?',
    args: [req.params.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Kamar tidak ditemukan.' });

  const { rows: tenants } = await db.execute({
    sql: "SELECT * FROM tenants WHERE room_id = ? ORDER BY status ASC, name ASC",
    args: [req.params.id],
  });
  res.json({ room: rows[0], tenants });
});

router.post('/', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { room_number, type, price, status, notes } = req.body || {};
  if (!room_number) return res.status(400).json({ error: 'Nomor kamar wajib diisi.' });
  if (type && !VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Tipe kamar tidak valid.' });
  if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Status kamar tidak valid.' });

  const result = await db.execute({
    sql: `INSERT INTO rooms (room_number, type, price, status, notes) VALUES (?, ?, ?, ?, ?)`,
    args: [
      String(room_number).trim(),
      type || 'single',
      Number.parseInt(price, 10) || 0,
      status || 'available',
      notes || null,
    ],
  });

  const { rows } = await db.execute({
    sql: 'SELECT * FROM rooms WHERE id = ?',
    args: [Number(result.lastInsertRowid)],
  });
  res.status(201).json({ room: rows[0] });
});

router.put('/:id', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows: existing } = await db.execute({
    sql: 'SELECT * FROM rooms WHERE id = ?',
    args: [req.params.id],
  });
  if (existing.length === 0) return res.status(404).json({ error: 'Kamar tidak ditemukan.' });
  const room = existing[0];

  const { room_number, type, price, status, notes } = req.body || {};
  if (type && !VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Tipe kamar tidak valid.' });
  if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Status kamar tidak valid.' });

  await db.execute({
    sql: `UPDATE rooms SET room_number = ?, type = ?, price = ?, status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
    args: [
      room_number != null ? String(room_number).trim() : room.room_number,
      type || room.type,
      price != null ? Number.parseInt(price, 10) || 0 : room.price,
      status || room.status,
      notes !== undefined ? notes : room.notes,
      req.params.id,
    ],
  });

  const { rows: updated } = await db.execute({
    sql: 'SELECT * FROM rooms WHERE id = ?',
    args: [req.params.id],
  });
  res.json({ room: updated[0] });
});

router.delete('/:id', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows } = await db.execute({
    sql: 'SELECT * FROM rooms WHERE id = ?',
    args: [req.params.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Kamar tidak ditemukan.' });

  const { rows: activeRows } = await db.execute({
    sql: "SELECT COUNT(*) AS c FROM tenants WHERE room_id = ? AND status = 'active'",
    args: [req.params.id],
  });
  if (activeRows[0].c > 0) {
    return res.status(409).json({ error: 'Tidak dapat menghapus kamar yang masih memiliki penghuni aktif.' });
  }

  await db.execute({ sql: 'DELETE FROM rooms WHERE id = ?', args: [req.params.id] });
  res.json({ ok: true });
});

export default router;
