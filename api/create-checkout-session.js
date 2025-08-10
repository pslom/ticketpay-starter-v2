const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,   
  ssl: { rejectUnauthorized: false },           
  max: 3
});

module.exports = async (req, res) => {
 
};

  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  if (!isAuthorized(req, body)) return res.status(401).json({ error: 'Unauthorized' });

  const { ticket_no } = body;
  if (!ticket_no) return res.status(400).json({ error: 'ticket_no is required' });

  const client = await pool.connect();
  try {
    const r = await client.query(
      'select id, ticket_no, balance_cents, status from tickets where ticket_no=$1',
      [ticket_no]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const t = r.rows[0];
    if (t.balance_cents <= 0 || t.status === 'paid') {
      return res.status(400).json({ error: 'Ticket already paid or balance is zero' });
    }

    const site = `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Ticket ${t.ticket_no}` },
          unit_amount: t.balance_cents
        },
        quantity: 1
      }],
      success_url: `${site}/success.html?ticket_no=${encodeURIComponent(t.ticket_no)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/cancel.html?ticket_no=${encodeURIComponent(t.ticket_no)}`,
      metadata: { ticket_no: t.ticket_no }
    });

    return res.status(200).json({ ok: true, url: session.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
};
