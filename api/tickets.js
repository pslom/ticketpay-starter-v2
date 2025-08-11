const { Pool } = require('pg');
const { setCors, isAuthorized } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { ticket_no, id } = req.query || {};
  if (!ticket_no && !id) return res.status(400).json({ error: 'Provide ticket_no or id' });

  const client = await pool.connect();
  try {
    const where = ticket_no ? 't.ticket_no=$1' : 't.id=$1::uuid';
    const val = ticket_no ? ticket_no : id;

    const q = `
      select
        t.id, t.ticket_no, t.balance_cents, t.status, t.due_at, t.created_at, t.updated_at,
        c.id as customer_id, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
        coalesce(sum(case when p.status='succeeded' then p.amount_cents else 0 end), 0) as paid_cents,
        (t.balance_cents - coalesce(sum(case when p.status='succeeded' then p.amount_cents else 0 end), 0)) as remaining_cents
      from tickets t
      left join customers c on c.id = t.customer_id
      left join payments p on p.ticket_id = t.id
      where ${where}
      group by t.id, c.id
      limit 1;
    `;
    const r = await client.query(q, [val]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ ok: true, ticket: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
};
