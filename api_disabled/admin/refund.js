// /api/admin/refund.js
const Stripe = require("stripe");
const { Pool } = require("pg");
const { cors, json, isAuthorized } = require("../_shared");

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
    if (!isAuthorized(req)) return json(res, 401, { error: "Unauthorized" });

    const { ticket_id, amount_cents } = JSON.parse(req.body || "{}");
    if (!ticket_id) return json(res, 400, { error: "ticket_id required" });

    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        "select p.provider_id from payments p where p.ticket_id = $1 and p.status = 'succeeded' order by created_at desc limit 1",
        [ticket_id]
      );
      if (!rows.length) return json(res, 404, { error: "No payment to refund" });

      await stripe.refunds.create({ payment_intent: rows[0].provider_id, amount: amount_cents || undefined });

      await client.query("update tickets set status = 'refunded', updated_at = now() where id = $1", [ticket_id]);
      return json(res, 200, { ok: true });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("refund error:", e);
    return json(res, 500, { error: "Refund failed" });
  }
};
