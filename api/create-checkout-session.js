// api/create-checkout-session.js
// Fully self-contained replacement: Stripe Checkout with a visible service fee.

const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Small pg pool for serverless
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

// CORS helper so Carrd can call us
function withCors(res) {
  res.setHeader('Content-Type', 'application/json');
  if (process.env.ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

// Calculate a service fee that covers Stripe fees and leaves a modest profit.
// targetProfitCents = how much you want to net after Stripe fees, e.g. 100 = $1
function calcServiceFeeCents(amountCents, targetProfitCents = 100, stripeRate = 0.029, stripeFixed = 30) {
  const A = Number(amountCents || 0);
  const r = stripeRate;
  const c = stripeFixed;
  // Net after Stripe on the fee line = S*(1 - r) - (r*A + c)
  // Solve for S so Net = targetProfitCents
  const S = (targetProfitCents + r * A + c) / (1 - r);
  return Math.max(0, Math.round(S));
}

module.exports = async (req, res) => {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end(JSON.stringify({ error: 'Method not allowed' }));

  try {
    // Expect JSON: { ticket_no: "TKT-1001" }
    const body = req.body || {};
    const ticket_no = String(body.ticket_no || '').trim();
    if (!ticket_no) {
      return res.status(400).end(JSON.stringify({ ok: false, error: 'ticket_no is required' }));
    }

    const client = await pool.connect();
    try {
      // Fetch the ticket. We support either remaining_cents (your current API) or balance_cents (new schema).
      const q = await client.query(
        'select * from tickets where ticket_no = $1 limit 1',
        [ticket_no]
      );
      if (q.rows.length === 0) {
        return res.status(404).end(JSON.stringify({ ok: false, error: 'Ticket not found' }));
      }
      const t = q.rows[0];

      // Determine amount due in cents
      const amountCents = Number(
        (t.remaining_cents !== undefined && t.remaining_cents !== null ? t.remaining_cents : t.balance_cents) || 0
      );

      if (!amountCents || amountCents < 0) {
        return res.status(400).end(JSON.stringify({ ok: false, error: 'No amount due for this ticket' }));
      }

      // Optionally block paid tickets
      if (t.status && String(t.status).toLowerCase() === 'paid') {
        return res.status(400).end(JSON.stringify({ ok: false, error: 'This ticket is already paid' }));
      }

      // Compute a modest profit after Stripe fees. Start with $1 net.
      const serviceFeeCents = calcServiceFeeCents(amountCents, 100); // change 100 to adjust your net profit in cents

      const lineItems = [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `Ticket ${ticket_no}` },
            unit_amount: amountCents
          },
          quantity: 1
        },
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Service fee' },
            unit_amount: serviceFeeCents
          },
          quantity: 1
        }
      ];

      const successUrl = `${process.env.SITE_URL}/success.html?ticket_no=${encodeURIComponent(ticket_no)}`;
      const cancelUrl = `${process.env.SITE_URL}/cancel.html?ticket_no=${encodeURIComponent(ticket_no)}`;

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          ticket_no,
          service_fee_cents: String(serviceFeeCents)
        }
      });

      return res.status(200).end(JSON.stringify({ ok: true, url: session.url }));
    } finally {
      // Release db connection
      // Vercel will reuse the pool across invocations
      // so just release here.
      try { client.release(); } catch {}
    }
  } catch (e) {
    console.error('create-checkout-session error:', e);
    return res.status(500).end(JSON.stringify({ ok: false, error: e.message }));
  }
};
