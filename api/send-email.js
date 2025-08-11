const sgMail = require('@sendgrid/mail');
const { setCors, isAuthorized, parseBody } = require('./_util');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  if (!isAuthorized(req, body)) return res.status(401).json({ error: 'Unauthorized' });

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL;
  if (!SENDGRID_API_KEY || !FROM_EMAIL) return res.status(500).json({ error: 'Missing SENDGRID_API_KEY or FROM_EMAIL' });
  sgMail.setApiKey(SENDGRID_API_KEY);

  const to = body.to;
  const subject = body.subject || 'Notification';
  const html = body.html;
  const text = body.text;
  const replyTo = body.replyTo;

  if (!to || (!html && !text)) return res.status(400).json({ error: "Need 'to' and 'html' or 'text'" });

  const msg = { to, from: FROM_EMAIL, subject };
  if (html) msg.html = html;
  if (text) msg.text = text;
  if (replyTo) msg.replyTo = replyTo;

  try {
    const [resp] = await sgMail.send(msg);
    return res.status(200).json({ ok: true, status: resp.statusCode });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
};
