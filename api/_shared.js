// /api/_shared.js
function normalizeOrigin(o) {
  if (!o) return null;
  try { const u = new URL(o); return `${u.protocol}//${u.host}`.toLowerCase(); }
  catch { return String(o).toLowerCase().replace(/\/+$/, ""); }
}

function cors(res, req) {
  const origin = normalizeOrigin(req?.headers?.origin || "");
  const allowed = (process.env.ALLOWED_ORIGIN || "")
    .split(",").map(s => normalizeOrigin(s.trim())).filter(Boolean);

  if (origin && (allowed.includes("*") || allowed.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin); // single origin echo
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization");
}

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = { cors, json };
