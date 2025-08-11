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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
}

function isAuthorized(req) {
  const headerKey = req.headers["x-api-key"];
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return (headerKey || bearer) === process.env.API_KEY; // keep this if API_KEY is what you set in Vercel
}

module.exports = async (req, res) => {
  setCors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { rows } = await pool.query("SELECT NOW() as now");
    return res.status(200).json({ ok: true, now: rows[0].now });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
