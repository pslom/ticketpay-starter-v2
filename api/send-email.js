// api/send-email.js
const sg = require('@sendgrid/mail');
const { json, cors, parseBody } = require('./_util');

sg.setApiKey(process.env.SENDGRID_API_KEY || '');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const body = await parseBody(req);
    const to = body.to;
    const subject = body.subject || 'TicketPay';
    const text = body.text || '';
    if (!to) return json(res, 400, { ok:false, error:'to required' });
    await sg.send({ to, from: process.env.FROM_EMAIL, subject, text });
    return json(res, 200, { ok:true });
  } catch (e) {
    return json(res, 500, { ok:false, error: e.message });
  }
};
