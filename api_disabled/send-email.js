// api/send-email.js
const sg = require('@sendgrid/mail');
const { json, cors, parseBody } = require('./_util');

if (process.env.SENDGRID_API_KEY) {
  sg.setApiKey(process.env.SENDGRID_API_KEY);
}

module.exports = async (req, res) => {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const body = await parseBody(req);
    const to = body.to;
    const subject = body.subject || 'TicketPay';
    const text = body.text || '';
    const from = process.env.FROM_EMAIL || 'no-reply@ticketpay.us.com';

    if (!to) return json(res, 400, { ok: false, error: 'to required' }, req);
    if (!process.env.SENDGRID_API_KEY) return json(res, 200, { ok: true, dry_run: true }, req);

    await sg.send({ to, from, subject, text });
    return json(res, 200, { ok: true }, req);
  } catch (e) {
    return json(res, 500, { ok: false, error: e.message }, req);
  }
};
