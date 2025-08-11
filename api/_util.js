// api/_util.js
const allowed = process.env.ALLOWED_ORIGIN || '*';

function cors(res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function json(res, code, data) {
  cors(res);
  res.status(code).end(JSON.stringify(data));
}

async function parseBody(req) {
  if (req.body) return req.body;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
  });
}

function requireApiKey(req) {
  const need = process.env.API_KEY;
  if (!need) return true;
  const got = req.headers['x-api-key'];
  return !!got && got === need;
}

module.exports = { cors, json, parseBody, requireApiKey };
