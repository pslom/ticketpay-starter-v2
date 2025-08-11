// api/send-email.js
const sg = require('@sendgrid/mail');
const { setCors, json, parseBody } = require('./_util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const body = await parseBody(req);
  try {
    sg.setApiKey(process.env.SENDGRID_API_KEY);
    const from = process.env.FROM_EMAIL;
    if (!from) return json(res, 500, { error: 'FROM_EMAIL not set' });

    const msg = {
      to: body.to,
      from,
      subject: body.subject || 'TicketPay',
      text: body.text || '',
    };
    await sg.send(msg);
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
};
