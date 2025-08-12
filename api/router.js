// api/router.js
// One function that handles all API routes (keeps you under the Hobby plan limit)

const { URL } = require("url");

// Helper: read request body as text
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

module.exports = async (req, res) => {
  // Figure out which logical route was requested
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  // ---------- Health ----------
  if (req.method === "GET" && pathname === "/api/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
    return;
  }

  // ---------- Lookup (placeholder) ----------
  if (req.method === "POST" && pathname === "/api/lookup") {
    const body = await readBody(req);
    const ct = req.headers["content-type"] || "";
    let data = {};
    if (ct.includes("application/json")) {
      try { data = JSON.parse(body || "{}"); } catch {}
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      data = Object.fromEntries(new URLSearchParams(body));
    }
    // TODO: Replace with your real DB lookup logic.
    // Returning an empty result keeps the build/deploy working.
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ tickets: [], state: data.state || null, plate: data.plate || null }));
    return;
  }

  // ---------- Webhooks (acknowledge fast; wire real logic later) ----------
  if (req.method === "POST" && pathname === "/api/webhooks/stripe") {
    // TODO: verify signature + handle events
    res.statusCode = 200; res.end("ok"); return;
  }
  if (req.method === "POST" && pathname === "/api/webhooks/twilio") {
    // TODO: verify signature + STOP/START/HELP handling
    res.statusCode = 200; res.end("ok"); return;
  }

  // ---------- Tasks (cron) ----------
  if (req.method === "POST" &&
     (pathname === "/api/tasks/send_due_reminders" || pathname === "/api/tasks/send_past_due")) {
    // TODO: perform the sends with your rate-limit checks
    res.statusCode = 200; res.end("queued"); return;
  }

  // ---------- Admin ----------
  if (req.method === "GET" && pathname === "/api/admin/sms-log") {
    // TODO: return audit logs from DB
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end("[]");
    return;
  }

  // Fallback
  res.statusCode = 404;
  res.end("Not found");
};
