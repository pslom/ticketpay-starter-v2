// api/twilio-inbound.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

function twiml(msg) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${msg}</Message></Response>`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const from = body.From || body.from || '';
  const text = String(body.Body || body.body || '').trim().toUpperCase();

  if (!from) {
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).end(twiml(''));
  }

  const client = await pool.connect();
  try {
    if (['STOP','STOP ALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(text)) {
      await client.query('insert into sms_opt_out(phone) values($1) on conflict (phone) do update set opted_out_at=now()', [from]);
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).end(twiml('You are opted out. Reply START to opt in again.'));
    }
    if (text === 'HELP') {
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).end(twiml('TicketPay alerts. Reply STOP to cancel. Need help? support@example.com'));
    }

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).end(twiml(''));
  } catch (e) {
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).end(twiml(''));
  } finally {
    client.release();
  }
};
