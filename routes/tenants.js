import { Router } from 'express';
import db from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

const VALID_STATUS = ['active', 'moved_out'];

function authCheck(req, res) {
  const user = requireAuth(req, res);
  return user;
}

async function syncRoomStatus(roomId) {
  if (!roomId) return;
  const { rows: rooms } = await db.execute({
    sql: 'SELECT * FROM rooms WHERE id = ?',
    args: [roomId],
  });
  const room = rooms[0];
  if (!room || room.status === 'maintenance') return;
  const { rows: activeRows } = await db.execute({
    sql: "SELECT COUNT(*) AS c FROM tenants WHERE room_id = ? AND status = 'active'",
    args: [roomId],
  });
  const newStatus = activeRows[0].c > 0 ? 'occupied' : 'available';
  if (newStatus !== room.status) {
    await db.execute({
      sql: "UPDATE rooms SET status = ?, updated_at = datetime('now') WHERE id = ?",
      args: [newStatus, roomId],
    });
  }
}

router.get('/', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { status, room_id, q } = req.query;
  const clauses = [];
  const args = [];

  if (status && VALID_STATUS.includes(status)) {
    clauses.push('t.status = ?');
    args.push(status);
  }
  if (room_id) {
    clauses.push('t.room_id = ?');
    args.push(room_id);
  }
  if (q) {
    clauses.push('(t.name LIKE ? OR t.phone LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.execute({
    sql: `SELECT t.*, r.room_number
      FROM tenants t LEFT JOIN rooms r ON r.id = t.room_id
      ${where}
      ORDER BY t.status ASC, t.name COLLATE NOCASE ASC`,
    args,
  });
  res.json({ tenants: rows });
});

router.get('/:id', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows } = await db.execute({
    sql: `SELECT t.*, r.room_number FROM tenants t
      LEFT JOIN rooms r ON r.id = t.room_id WHERE t.id = ?`,
    args: [req.params.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Penghuni tidak ditemukan.' });

  const { rows: payments } = await db.execute({
    sql: 'SELECT * FROM payments WHERE tenant_id = ? ORDER BY period_year DESC, period_month DESC',
    args: [req.params.id],
  });
  res.json({ tenant: rows[0], payments });
});

router.post('/', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { room_id, name, phone, identity_number, start_date, status, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nama penghuni wajib diisi.' });
  if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });

  if (room_id) {
    const { rows } = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [room_id] });
    if (rows.length === 0) return res.status(400).json({ error: 'Kamar tidak ditemukan.' });
  }

  const result = await db.execute({
    sql: `INSERT INTO tenants (room_id, name, phone, identity_number, start_date, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      room_id || null,
      String(name).trim(),
      phone || null,
      identity_number || null,
      start_date || null,
      status || 'active',
      notes || null,
    ],
  });

  await syncRoomStatus(room_id);
  const { rows } = await db.execute({
    sql: 'SELECT * FROM tenants WHERE id = ?',
    args: [Number(result.lastInsertRowid)],
  });
  res.status(201).json({ tenant: rows[0] });
});

router.put('/:id', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows } = await db.execute({
    sql: 'SELECT * FROM tenants WHERE id = ?',
    args: [req.params.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Penghuni tidak ditemukan.' });
  const tenant = rows[0];

  const { room_id, name, phone, identity_number, start_date, status, notes } = req.body || {};
  if (status && !VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });

  const newRoomId = room_id !== undefined ? room_id || null : tenant.room_id;
  if (newRoomId) {
    const { rows: roomRows } = await db.execute({ sql: 'SELECT id FROM rooms WHERE id = ?', args: [newRoomId] });
    if (roomRows.length === 0) return res.status(400).json({ error: 'Kamar tidak ditemukan.' });
  }

  await db.execute({
    sql: `UPDATE tenants
      SET room_id = ?, name = ?, phone = ?, identity_number = ?, start_date = ?, status = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?`,
    args: [
      newRoomId,
      name != null ? String(name).trim() : tenant.name,
      phone !== undefined ? phone : tenant.phone,
      identity_number !== undefined ? identity_number : tenant.identity_number,
      start_date !== undefined ? start_date : tenant.start_date,
      status || tenant.status,
      notes !== undefined ? notes : tenant.notes,
      req.params.id,
    ],
  });

  await syncRoomStatus(tenant.room_id);
  await syncRoomStatus(newRoomId);

  const { rows: updated } = await db.execute({
    sql: 'SELECT * FROM tenants WHERE id = ?',
    args: [req.params.id],
  });
  res.json({ tenant: updated[0] });
});

router.delete('/:id', async (req, res) => {
  if (!authCheck(req, res)) return;

  const { rows } = await db.execute({
    sql: 'SELECT * FROM tenants WHERE id = ?',
    args: [req.params.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'Penghuni tidak ditemukan.' });
  const tenant = rows[0];

  await db.execute({ sql: 'DELETE FROM tenants WHERE id = ?', args: [req.params.id] });
  await syncRoomStatus(tenant.room_id);
  res.json({ ok: true });
});

export default router;
