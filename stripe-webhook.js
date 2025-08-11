// api/stripe-webhook.js
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { setCors } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const buf = await (async () => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    return Buffer.concat(chunks);
  })();

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const ticketNo = session.metadata && session.metadata.ticket_no;
    if (ticketNo) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        // mark ticket paid & insert payment if you have a payments table
        await client.query(`update tickets set status='paid' where ticket_no=$1`, [ticketNo]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
      } finally {
        client.release();
      }
    }
  }

  res.status(200).send('ok');
};
