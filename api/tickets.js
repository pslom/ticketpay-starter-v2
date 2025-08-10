const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,   
  ssl: { rejectUnauthorized: false },           
  max: 3
});

module.exports = async (req, res) => {

};

  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { ticket_no, id } = req.query || {};
  if (!ticket_no && !id) return res.status(400).json({ error: 'Provide ticket_no or id' });

  try {
    const client = await pool.connect();
    try {
      const q = ticket_no
        ? 'select t.*, c.name as customer_name, c.email, c.phone from tickets t left join customers c on c.id=t.customer_id where t.ticket_no=$1'
        : 'select t.*, c.name as customer_name, c.email, c.phone from tickets t left join customers c on c.id=t.customer_id where t.id=$1::uuid';
      const val = ticket_no ? ticket_no : id;
      const r = await client.query(q, [val]);
      if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ ok: true, ticket: r.rows[0] });
    } finally {
      client.release();
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
