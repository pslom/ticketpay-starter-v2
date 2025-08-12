// /api/admin/void.js
const { Pool } = require("pg");
const { cors, json, isAuthorized } = require("../_shared");

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

    const { ticket_id } = JSON.parse(req.body || "{}");
    if (!ticket_id) return json(res, 400, { error: "ticket_id required" });

    const { rowCount } = await pool.query("update tickets set status = 'void', updated_at = now() where id = $1", [ticket_id]);
    if (!rowCount) return json(res, 404, { error: "Ticket not found" });

    return json(res, 200, { ok: true });
  } catch (e) {
    console.error("void error:", e);
    return json(res, 500, { error: "Void failed" });
  }
};
