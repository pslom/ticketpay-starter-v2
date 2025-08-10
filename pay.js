const { Pool } = require('pg');
const { setCors, isAuthorized, parseBody } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  ssl: { rejectUnauthorized: false }
});

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  if (!isAuthorized(req, body)) return res.status(401).json({ error: 'Unauthorized' });

  const { ticket_no, ticket_id, amount_cents } = body;
  if ((!ticket_no && !ticket_id) || !amount_cents) {
    return res.status(400).json({ error: 'ticket_no or ticket_id, and amount_cents are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const findQ = ticket_no
      ? 'select * from tickets where ticket_no=$1 for update'
      : 'select * from tickets where id=$1::uuid for update';
    const findV = ticket_no ? ticket_no : ticket_id;
    const r = await client.query(findQ, [findV]);
    if (!r.rows.length) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Ticket not found' });
    }
    const t = r.rows[0];

    // Mock processing delay
    await sleep(1500);

    const remaining = Math.max(0, t.balance_cents - parseInt(amount_cents, 10));
    const newStatus = remaining === 0 ? 'paid' : t.status;

    await client.query(
      'insert into payments(ticket_id, processor, amount_cents, status, external_id) values ($1,$2,$3,$4,$5)',
      [t.id, 'mock', parseInt(amount_cents, 10), 'succeeded', 'mock-' + Date.now()]
    );
    await client.query(
      'update tickets set balance_cents=$1, status=$2 where id=$3',
      [remaining, newStatus, t.id]
    );
    await client.query(
      'insert into audit_log(actor, action, target_type, target_id, meta_json) values ($1,$2,$3,$4,$5)',
      ['system', 'mock_payment', 'ticket', t.id, JSON.stringify({ amount_cents })]
    );

    await client.query('commit');
    return res.status(200).json({ ok: true, ticket_id: t.id, ticket_no: t.ticket_no, remaining_cents: remaining, status: newStatus });
  } catch (e) {
    await client.query('rollback');
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
};