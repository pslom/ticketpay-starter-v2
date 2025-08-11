// /api/tickets.js
const { Pool } = require("pg");
const { cors, json } = require("./_shared"); // use the shared one that echoes a single origin

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });

module.exports = async (req, res) => {
  cors(res, req);                                  // <- this ensures a single Origin is echoed
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const { ticket_no, plate, state } = req.query || {};
  if (!ticket_no && !(plate && state)) return json(res, 400, { error: "Missing identifier" });

  try {
    const client = await pool.connect();
    try {
      const q = ticket_no
        ? client.query("select * from tickets where ticket_no = $1 limit 1", [ticket_no])
        : client.query("select * from tickets where plate = $1 and state = $2 order by issued_at desc limit 1", [plate, state]);

      const { rows } = await q;
      if (!rows.length) return json(res, 404, { error: "Ticket not found" });

      const t = rows[0];
      if (t.status === "paid") return json(res, 409, { error: "Already paid" });

      return json(res, 200, {
        ok: true,
        ticket: {
          id: t.id,
          ticket_no: t.ticket_no,
          status: t.status,
          remaining_cents: t.remaining_cents,
          customer_name: t.customer_name,
          customer_email: t.customer_email,
          customer_phone: t.customer_phone,
          due_at: t.due_at,
          created_at: t.created_at,
          updated_at: t.updated_at,
        }
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: "Server error" });
  }
};
