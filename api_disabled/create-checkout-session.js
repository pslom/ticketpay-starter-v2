// /api/create-checkout-session.js
const Stripe = require("stripe");
const { Pool } = require("pg");
const { cors, json } = require("./_shared");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  try {
    cors(res, req);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

    const { ticket_id, email, phone } = JSON.parse(req.body || "{}");
    if (!ticket_id) return json(res, 400, { error: "ticket_id required" });

    const client = await pool.connect();
    try {
      const { rows } = await client.query("select * from tickets where id = $1 limit 1", [ticket_id]);
      if (!rows.length) return json(res, 404, { error: "Ticket not found" });
      const t = rows[0];

      if (!["open", "pending_payment"].includes(t.status)) {
        return json(res, 409, { error: `Cannot pay ticket in status ${t.status}` });
      }

      const amount = t.remaining_cents ?? t.amount_cents;
      if (!amount || amount <= 0) return json(res, 409, { error: "No balance due" });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card", "us_bank_account"],
        phone_number_collection: { enabled: true },
        customer_email: email || undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amount,
            product_data: { name: `Ticket ${t.ticket_no}` }
          }
        }],
        success_url: `${process.env.SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_URL}/cancel.html`,
        metadata: {
          ticket_id: t.id,
          ticket_no: t.ticket_no
        }
      }, { idempotencyKey: `tkt-${t.id}` });

      await client.query("update tickets set status = 'pending_payment' where id = $1", [t.id]);

      return json(res, 200, { ok: true, url: session.url, id: session.id });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("create-checkout-session error:", e);
    return json(res, 500, { error: "Stripe error" });
  }
};
