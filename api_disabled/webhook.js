// /api/webhook.js
const Stripe = require("stripe");
const { Pool } = require("pg");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  // DO NOT use CORS or parse JSON here; Stripe needs raw body for signature check.
  // In Vercel, set this function's body parsing to "raw" (Project → Settings → Functions if configured,
  // or add an edge function wrapper that forwards raw).
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const type = event.type;
    const obj = event.data.object;

    if (type === "checkout.session.completed" || type === "payment_intent.succeeded") {
      const ticketId = obj.metadata?.ticket_id || obj.metadata?.ticketId;
      const amount = obj.amount_total || obj.amount_received || 0;
      const providerId = obj.id || obj.payment_intent;

      if (ticketId && amount > 0) {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query(
            "insert into payments (ticket_id, provider_id, amount_cents, status, method, created_at) values ($1, $2, $3, $4, $5, now())",
            [ticketId, String(providerId), amount, "succeeded", obj.payment_method_types?.[0] || "card"]
          );
          await client.query(
            "update tickets set status = 'paid', remaining_cents = greatest(0, coalesce(remaining_cents,0) - $1), updated_at = now() where id = $2",
            [amount, ticketId]
          );
          // optional: update last_payment_provider_id on tickets if you store it
          await client.query("commit");
        } catch (e) {
          await client.query("rollback");
          throw e;
        } finally {
          client.release();
        }
      }
    }

    // You can log the raw event here to a webhook_events table for later reconciliation if you want.

    return res.status(200).end();
  } catch (err) {
    console.error("webhook error:", err);
    return res.status(500).end();
  }
};
