const { Pool } = require('pg');
const Stripe = require('stripe');
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

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) return res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY' });
  const stripe = Stripe(stripeSecret);

  const { ticket_no, id } = body || {};
  if (!ticket_no && !id) return res.status(400).json({ error: 'Provide ticket_no or id' });

  const client = await pool.connect();
  try {
    const where = ticket_no ? 't.ticket_no=$1' : 't.id=$1::uuid';
    const val = ticket_no ? ticket_no : id;
    const q = `
      select
        t.id, t.ticket_no, t.balance_cents,
        coalesce(sum(case when p.status='succeeded' then p.amount_cents else 0 end), 0) as paid_cents
      from tickets t
      left join payments p on p.ticket_id = t.id
      where ${where}
      group by t.id
      limit 1;
    `;
    const r = await client.query(q, [val]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const t = r.rows[0];
    const remaining = t.balance_cents - t.paid_cents;
    if (remaining <= 0) return res.status(400).json({ error: 'Ticket already paid' });

    const site = process.env.SITE_URL || (req.headers.origin || '').replace(/\/$/,'') || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Ticket ${t.ticket_no}` },
          unit_amount: remaining
        },
        quantity: 1
      }],
      success_url: `${site}/success.html?ticket_no=${encodeURIComponent(t.ticket_no)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/cancel.html?ticket_no=${encodeURIComponent(t.ticket_no)}`,
      metadata: { ticket_no: t.ticket_no, ticket_id: t.id }
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
};
