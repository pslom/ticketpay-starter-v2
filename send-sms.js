// api/send-sms.js
const twilio = require('twilio');
const { setCors, json, parseBody } = require('./_util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const body = await parseBody(req);
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!from) return json(res, 500, { error:'TWILIO_FROM_NUMBER not set' });

    const r = await client.messages.create({ to: body.to, from, body: body.body });
    return json(res, 200, { ok:true, sid: r.sid });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
};
