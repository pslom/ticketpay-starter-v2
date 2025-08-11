// /api/health.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

function setCors(res, req) {
  const origin = req.headers.origin || '';
  const allowed = process.env.ALLOWED_ORIGIN || origin;
  if (allowed && origin && origin === allowed) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
}

function isAuthorized(req) {
  const headerKey = req.headers['x-api-key'];
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return (headerKey || bearer) === process.env.API_KEY;
}

module.exports = async (req, res) => {
  setCors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { rows } = await pool.query('SELECT NOW() as now');
    return res.status(200).json({ ok: true, now: rows[0].now });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
