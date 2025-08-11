// api/_util.js
const allowed = process.env.ALLOWED_ORIGIN || '*';

function cors(res, req) {
  const origin = req?.headers?.origin || '';
  const reqHeaders = req?.headers?.['access-control-request-headers'] || '*';

  res.setHeader('Vary', 'Origin');
  res.setHeader('Content-Type', 'application/json');

  // allow exact origin or wildcard in test
  res.setHeader('Access-Control-Allow-Origin', allowed === '*' ? (origin || '*') : allowed);

  // echo requested headers so preflight passes
  res.setHeader('Access-Control-Allow-Headers', reqHeaders);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function json(res, code, data, req) {
  cors(res, req);
  res.status(code).end(JSON.stringify(data));
}

async function parseBody(req) {
  if (req.body) return req.body;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
  });
}

function requireApiKey(req) {
  const need = process.env.API_KEY;
  if (!need) return true;
  return (req.headers['x-api-key'] || '') === need;
}

module.exports = { cors, json, parseBody, requireApiKey };
