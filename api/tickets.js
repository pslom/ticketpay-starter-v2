// api/tickets.js
const { Pool } = require('pg');
const { cors, json } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const ticketNo = (req.query.ticket_no || req.query.ticket || '').trim();
    if (!ticketNo) return json(res, 400, { ok: false, error: 'ticket_no is required' });

    const client = await pool.connect();
    try {
      const q = await client.query(
        `select id, ticket_no, status, coalesce(remaining_cents, balance_cents, 0) as remaining_cents,
                customer_name, customer_email, customer_phone, due_at, created_at, updated_at
         from tickets where ticket_no = $1 limit 1`,
        [ticketNo]
      );
      if (q.rows.length === 0) return json(res, 200, { ok: false, error: 'Ticket not found' });
      return json(res, 200, { ok: true, ticket: q.rows[0] });
    } finally {
      client.release();
    }
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message });
  }
};
