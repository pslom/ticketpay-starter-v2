// /api/health.js
const { Pool } = require("pg");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

function normalizeOrigin(o) {
  if (!o) return null;
  try { const u = new URL(o); return `${u.protocol}//${u.host}`.toLowerCase(); }
  catch { return String(o).toLowerCase().replace(/\/+$/, ""); }
}

function setCors(res, req) {
  const origin = normalizeOrigin(req.headers.origin || "");
  const allowedList = (process.env.ALLOWED_ORIGIN || "")
    .split(",").map(s => normalizeOrigin(s.trim())).filter(Boolean);

  if (origin && (allowedList.includes("*") || allowedList.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
}

module.exports = async (req, res) => {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const { rows } = await pool.query("SELECT NOW() as now");
    res.status(200).json({ ok: true, now: rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
