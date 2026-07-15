import { Router } from 'express';
import db from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

router.get('/', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const { rows: roomRows } = await db.execute({
    sql: `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied,
      SUM(CASE WHEN status = 'maintenance' THEN 1 ELSE 0 END) AS maintenance
      FROM rooms`,
    args: [],
  });
  const rooms = roomRows[0] || {};

  const { rows: tenantRows } = await db.execute({
    sql: "SELECT COUNT(*) AS c FROM tenants WHERE status = 'active'",
    args: [],
  });
  const activeTenants = tenantRows[0]?.c || 0;

  const { rows: incomeRows } = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE status = 'paid' AND period_month = ? AND period_year = ?`,
    args: [month, year],
  });
  const incomeThisMonth = incomeRows[0]?.total || 0;

  const { rows: outstandingRows } = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM payments WHERE status IN ('unpaid', 'late')`,
    args: [],
  });
  const outstanding = outstandingRows[0] || {};

  const { rows: dueList } = await db.execute({
    sql: `SELECT p.*, t.name AS tenant_name, t.phone AS tenant_phone, r.room_number
      FROM payments p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN rooms r ON r.id = p.room_id
      WHERE p.status IN ('unpaid', 'late')
      ORDER BY p.period_year ASC, p.period_month ASC
      LIMIT 20`,
    args: [],
  });

  const { rows: trendRows } = await db.execute({
    sql: `SELECT period_year AS year, period_month AS month, COALESCE(SUM(amount), 0) AS total
      FROM payments WHERE status = 'paid'
      GROUP BY period_year, period_month
      ORDER BY period_year DESC, period_month DESC
      LIMIT 6`,
    args: [],
  });
  const trend = trendRows.reverse();

  res.json({
    period: { month, year },
    rooms: {
      total: rooms.total || 0,
      available: rooms.available || 0,
      occupied: rooms.occupied || 0,
      maintenance: rooms.maintenance || 0,
    },
    activeTenants,
    incomeThisMonth,
    outstanding: { total: outstanding.total, count: outstanding.count },
    dueList,
    trend,
  });
});

export default router;
