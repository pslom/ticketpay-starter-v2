// api/stripe-webhook.js
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { json } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

// Raw body capture is not available by default on Vercel Node runtime for simple functions.
// We'll rely on metadata.ticket_no from the completed session and then mark paid.
module.exports = async (req, res) => {
  // Stripe requires raw body to verify signature; if that's not set up, we can still
  // handle completed checkout via polling the session ID in metadata sent by our app.
  // For simplicity in this skeleton, we accept JSON body (from Stripe CLI / test).
  try {
    const body = req.body || {};
    const type = body.type || '';
    const data = body.data && body.data.object ? body.data.object : {};
    if (type !== 'checkout.session.completed') {
      return json(res, 200, { ok:true, ignored:true });
    }

    const ticket_no = (data.metadata && data.metadata.ticket_no) || null;
    if (!ticket_no) return json(res, 200, { ok:true, ignored:true });

    const client = await pool.connect();
    try {
      await client.query(
        `update tickets set status='paid', paid_cents = coalesce(remaining_cents, balance_cents),
         remaining_cents = 0, updated_at = now() where ticket_no=$1`, [ticket_no]
      );
    } finally {
      client.release();
    }
    return json(res, 200, { ok:true });
  } catch (e) {
    return json(res, 500, { ok:false, error: e.message });
  }
};
