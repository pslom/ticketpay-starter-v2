// api/send-sms.js
const twilio = require('twilio');
const { json, cors, parseBody } = require('./_util');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const body = await parseBody(req);
    const to = body.to;
    const text = body.body || body.text;
    if (!to || !text) return json(res, 400, { ok:false, error:'to and body required' });
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({ to, from: process.env.TWILIO_FROM_NUMBER, body: text });
    return json(res, 200, { ok:true });
  } catch (e) {
    return json(res, 500, { ok:false, error: e.message });
  }
};
