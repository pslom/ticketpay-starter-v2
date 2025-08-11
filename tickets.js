// api/tickets.js
const { Pool } = require('pg');
const { setCors, json, isAuthorized } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });

  const { ticket_no, id } = req.query || {};
  const useNo = (ticket_no || '').trim();
  const useId = (id || '').trim();
  if (!useNo && !useId) return json(res, 400, { error: 'ticket_no or id is required' });

  const client = await pool.connect();
  try {
    const where = useNo ? 't.ticket_no = $1' : 't.id = $1';
    const val = useNo || useId;

    const q = `
      select
        t.id, t.ticket_no, t.balance_cents, t.status, t.due_at,
        t.created_at, t.updated_at,
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'email', c.email,
          'phone', c.phone
        ) as customer,
        coalesce(sum(p.amount_cents) filter (where p.status='succeeded'), 0) as paid_cents,
        greatest(t.balance_cents - coalesce(sum(p.amount_cents) filter (where p.status='succeeded'),0), 0) as remaining_cents
      from tickets t
      left join customers c on c.id = t.customer_id
      left join payments p on p.ticket_id = t.id
      where ${where}
      group by t.id, c.id
      limit 1;
    `;
    const r = await client.query(q, [val]);
    if (!r.rows.length) return json(res, 404, { error: 'Not found' });
    return json(res, 200, { ok: true, ticket: r.rows[0] });
  } catch (e) {
    return json(res, 500, { error: e.message });
  } finally {
    client.release();
  }
};
