// /api/tickets.js
const { Pool } = require("pg");
const { cors, json } = require("./_shared");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  try {
    cors(res, req);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

    const { ticket_no, plate, state } = req.query || {};
    if (!ticket_no && !(plate && state)) return json(res, 400, { error: "Missing identifier" });

    const client = await pool.connect();
    try {
      const q = ticket_no
        ? client.query("select * from tickets where ticket_no = $1 limit 1", [ticket_no])
        : client.query(
            "select * from tickets where plate = $1 and state = $2 order by issued_at desc limit 1",
            [plate, state]
          );

      const { rows } = await q;
      if (!rows.length) return json(res, 404, { error: "Ticket not found" });

      const t = rows[0];
      if (t.status === "paid") return json(res, 409, { error: "Already paid" });

      // No calculations — trust DB
      return json(res, 200, {
        ok: true,
        ticket: {
          id: t.id,
          ticket_no: t.ticket_no,
          plate: t.plate,
          state: t.state,
          status: t.status,
          amount_cents: t.amount_cents ?? null,
          fees_cents: t.fees_cents ?? null,
          discount_cents: t.discount_cents ?? null,
          remaining_cents: t.remaining_cents ?? t.amount_cents ?? null,
          due_at: t.due_at,
          issued_at: t.issued_at,
          channel: t.channel ?? null,
          customer_id: t.customer_id ?? null,
          evidence_url: t.evidence_url ?? null
        }
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("tickets error:", e);
    return json(res, 500, { error: "Server error" });
  }
};
