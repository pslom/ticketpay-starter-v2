const twilio = require('twilio');
const { setCors, isAuthorized, parseBody } = require('./_util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  if (!isAuthorized(req, body)) return res.status(401).json({ error: 'Unauthorized' });

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return res.status(500).json({ error: 'Missing Twilio env vars' });

  const client = twilio(sid, token);
  const to = body.to;
  const message = body.body || body.message;
  if (!to || !message) return res.status(400).json({ error: 'Need to and body' });

  try {
    const resp = await client.messages.create({ to, from, body: message });
    return res.status(200).json({ ok: true, sid: resp.sid, status: resp.status });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};