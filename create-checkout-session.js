// api/create-checkout-session.js
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { setCors, json, parseBody } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

function calcServiceFeeCents(amountCents, targetProfitCents = 100, stripeRate = 0.029, stripeFixed = 30) {
  const A = Number(amountCents || 0);
  const r = stripeRate;
  const c = stripeFixed;
  const S = (targetProfitCents + r * A + c) / (1 - r);
  return Math.max(0, Math.round(S));
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const ticket_no = String(body.ticket_no || '').trim();
    if (!ticket_no) return json(res, 400, { ok: false, error: 'ticket_no is required' });

    const client = await pool.connect();
    try {
      const q = await client.query('select * from tickets where ticket_no=$1 limit 1', [ticket_no]);
      if (!q.rows.length) return json(res, 404, { ok: false, error: 'Ticket not found' });
      const t = q.rows[0];

      const amountCents = Number((t.remaining_cents ?? t.balance_cents) || 0);
      if (!amountCents || amountCents < 0) return json(res, 400, { ok:false, error:'No amount due' });
      if (t.status && String(t.status).toLowerCase() === 'paid') return json(res, 400, { ok:false, error:'Ticket already paid' });

      const feeCents = calcServiceFeeCents(amountCents, 100);
      const lineItems = [
        { price_data: { currency:'usd', product_data:{ name:`Ticket ${ticket_no}` }, unit_amount: amountCents }, quantity: 1 },
        { price_data: { currency:'usd', product_data:{ name:'Service fee' }, unit_amount: feeCents }, quantity: 1 }
      ];

      const successUrl = `${process.env.SITE_URL}/success.html?ticket_no=${encodeURIComponent(ticket_no)}`;
      const cancelUrl  = `${process.env.SITE_URL}/cancel.html?ticket_no=${encodeURIComponent(ticket_no)}`;

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { ticket_no, service_fee_cents: String(feeCents) }
      });

      return json(res, 200, { ok:true, url: session.url });
    } finally {
      try { client.release(); } catch {}
    }
  } catch (e) {
    console.error('create-checkout-session error:', e);
    return json(res, 500, { ok:false, error: e.message });
  }
};
