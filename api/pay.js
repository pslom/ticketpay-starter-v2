const { Pool } = require('pg');
const { setCors, isAuthorized, parseBody } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  if (!isAuthorized(req, body)) return res.status(401).json({ error: 'Unauthorized' });

  const { ticket_no, id, amount_cents } = body || {};
  const amt = Number(amount_cents);
  if ((!ticket_no && !id) || !Number.isInteger(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Provide ticket_no or id and positive integer amount_cents' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    const where = ticket_no ? 't.ticket_no=$1' : 't.id=$1::uuid';
    const val = ticket_no ? ticket_no : id;

    const q = `
      select
        t.id, t.ticket_no, t.balance_cents, t.status,
        coalesce(sum(case when p.status='succeeded' then p.amount_cents else 0 end), 0) as paid_cents
      from tickets t
      left join payments p on p.ticket_id = t.id
      where ${where}
      group by t.id
      for update;
    `;
    const r = await client.query(q, [val]);
    if (!r.rows.length) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Not found' });
    }

    const t = r.rows[0];
    const remaining = t.balance_cents - t.paid_cents;
    if (remaining <= 0) {
      await client.query('rollback');
      return res.status(400).json({ error: 'Ticket already paid' });
    }

    const charge = Math.min(amt, remaining);
    const newRemaining = remaining - charge;
    const newStatus = newRemaining === 0 ? 'paid' : 'open';

    await client.query(
      `insert into payments(ticket_id, processor, amount_cents, status, external_id)
       values ($1,'mock',$2,'succeeded',$3)`,
      [t.id, charge, `mock-${Date.now()}`]
    );

    await client.query(
      `insert into audit_log(actor, action, target_type, target_id, meta_json)
       values ($1,$2,$3,$4,$5)`,
      ['system', 'mock_payment', 'ticket', t.id, JSON.stringify({ amount_cents: charge })]
    );

    await client.query(`update tickets set status=$1 where id=$2`, [newStatus, t.id]);
    await client.query('commit');

    return res.status(200).json({
      ok: true,
      ticket_id: t.id,
      ticket_no: t.ticket_no,
      charged_cents: charge,
      remaining_cents: newRemaining,
      status: newStatus
    });
  } catch (e) {
    await client.query('rollback');
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
};
