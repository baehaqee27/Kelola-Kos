import { Router } from 'express';
import db from '../lib/db.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
} from '../lib/auth.js';

const router = Router();

router.get('/registration-open', async (_req, res) => {
  const { rows } = await db.execute("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
  res.json({ open: rows.length === 0 });
});

router.post('/register', async (req, res) => {
  const { name, username, password, phone } = req.body || {};

  const { rows: owners } = await db.execute("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
  if (owners.length > 0) {
    return res
      .status(403)
      .json({ error: 'Registrasi ditutup. Akun pemilik sudah terdaftar. Silakan masuk.' });
  }

  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Nama, username, dan password wajib diisi.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter.' });
  }

  const { rows: existing } = await db.execute({
    sql: 'SELECT id FROM users WHERE username = ?',
    args: [username],
  });
  if (existing.length > 0) {
    return res.status(409).json({ error: 'Username sudah digunakan.' });
  }

  const result = await db.execute({
    sql: `INSERT INTO users (role, name, username, phone, password) VALUES ('owner', ?, ?, ?, ?)`,
    args: [name, username, phone || null, hashPassword(password)],
  });

  const user = {
    id: Number(result.lastInsertRowid),
    role: 'owner',
    name,
    username,
  };
  const token = signToken(user);
  setAuthCookie(res, token);
  res.status(201).json({ user, token });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  }

  const { rows } = await db.execute({
    sql: 'SELECT * FROM users WHERE username = ?',
    args: [username],
  });
  const row = rows[0];
  if (!row || !verifyPassword(password, row.password)) {
    return res.status(401).json({ error: 'Username atau password salah.' });
  }

  const user = { id: row.id, role: row.role, name: row.name, username: row.username };
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ user, token });
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const { rows } = await db.execute({
    sql: 'SELECT id, role, name, username, phone, created_at FROM users WHERE id = ?',
    args: [user.id],
  });
  if (rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan.' });
  res.json({ user: rows[0] });
});

export default router;
