// api/stripe-webhook.js
const Stripe = require('stripe');
const { Pool } = require('pg');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

// Read raw body for Stripe signature verification
async function getRawBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return Buffer.concat(ch);
}

module.exports = async (req, res) => {
  // Stripe calls this server-to-server. CORS not required, but OPTIONS is harmless.
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'Missing STRIPE_WEBHOOK_SECRET' });

  let event;
  try {
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const ticket_no = session.metadata && session.metadata.ticket_no;
    const ticket_id = session.metadata && session.metadata.ticket_id;
    const amount = session.amount_total || 0; // cents

    const client = await pool.connect();
    try {
      await client.query('begin');

      // Look up ticket
      const where = ticket_id ? 't.id=$1::uuid' : 't.ticket_no=$1';
      const val = ticket_id ? ticket_id : ticket_no;

      const q = `
        select t.id, t.ticket_no, t.balance_cents,
               coalesce(sum(case when p.status='succeeded' then p.amount_cents else 0 end),0) as paid_cents
        from tickets t
        left join payments p on p.ticket_id = t.id
        where ${where}
        group by t.id
        for update;
      `;
      const r = await client.query(q, [val]);
      if (!r.rows.length) {
        await client.query('rollback');
        return res.status(200).json({ ok: true, note: 'ticket not found, ignored' });
      }

      const t = r.rows[0];
      const remaining = t.balance_cents - t.paid_cents;
      const charge = Math.max(0, Math.min(amount, remaining));

      // Record payment
      await client.query(
        `insert into payments(ticket_id, processor, amount_cents, status, external_id)
         values ($1,'stripe',$2,'succeeded',$3)`,
        [t.id, charge, session.id]
      );

      // Update status if fully paid
      const newRemaining = remaining - charge;
      const newStatus = newRemaining <= 0 ? 'paid' : 'open';
      await client.query(`update tickets set status=$1 where id=$2`, [newStatus, t.id]);

      await client.query('commit');
      return res.status(200).json({ ok: true, ticket_no: t.ticket_no, charged_cents: charge, status: newStatus });
    } catch (e) {
      await client.query('rollback');
      return res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  }

  // Ignore other events for now
  return res.status(200).json({ ok: true });
};
