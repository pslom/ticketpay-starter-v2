const { Pool } = require('pg');

module.exports = async (req, res) => {
  const cfg = {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // allow Supabase test cert
    max: 1
  };
  const pool = new Pool(cfg);
  try {
    const c = await pool.connect();
    const r = await c.query('select current_database() db');
    c.release();
    await pool.end().catch(()=>{});
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ ok: true, db: r.rows[0].db });
  } catch (e) {
    await pool.end().catch(()=>{});
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ ok: false, message: e.message });
  }
};
