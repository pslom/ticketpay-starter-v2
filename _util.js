// api/_util.js
// One tiny utility module for consistency.
function setCors(res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
}
function json(res, code, obj) {
  res.setHeader('Content-Type', 'application/json');
  if (process.env.ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.status(code).end(JSON.stringify(obj));
}
function isAuthorized(req, body) {
  const configuredKey = process.env.API_KEY;
  const headerKey = req.headers['x-api-key'];
  const bodyKey = body && body.apiKey;
  if (!configuredKey) return true;       // public if no API_KEY set
  return headerKey === configuredKey || bodyKey === configuredKey;
}
async function parseBody(req) {
  if (req.body && Object.keys(req.body).length) return req.body;
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_){}
  try {
    const params = new URLSearchParams(raw);
    const obj = {}; for (const [k,v] of params.entries()) obj[k]=v;
    return obj;
  } catch(_) { return {}; }
}
module.exports = { setCors, json, isAuthorized, parseBody };
