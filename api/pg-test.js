const { Pool } = require('pg');

async function tryConnect(label, cfg) {
  const pool = new Pool(cfg);
  try {
    const c = await pool.connect();
    const r = await c.query('select current_database() db');
    c.release();
    await pool.end().catch(()=>{});
    return { label, ok: true, db: r.rows[0].db };
  } catch (e) {
    await pool.end().catch(()=>{});
    return { label, ok: false, error: e.message };
  }
}

async function handler(req, res) {
  const url = process.env.DATABASE_URL || "";
  const cfg1 = {
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 1
  };
  const cfg2 = {
    connectionString: url.replace('?sslmode=require',''),
    ssl: { rejectUnauthorized: false },
    max: 1
  };

  const results = [];
  results.push({ note: "env present?", hasUrl: !!url, sample: url.slice(0, 60) + (url.length>60?'...':'') });
  results.push(await tryConnect('as-is', cfg1));
  results.push(await tryConnect('stripped-sslmode', cfg2));

  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(results);
}

module.exports = handler;
