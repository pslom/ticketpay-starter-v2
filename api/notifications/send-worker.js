// api/notifications/send-worker.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

function json(res, code, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.status(code).end(JSON.stringify(data));
}

async function getTicket(client, ticketId) {
  const r = await client.query(
    `select t.ticket_no, t.balance_cents, t.due_at,
            pl.plate, pl.state, pl.city, u.email, u.phone
     from tickets t
     join plates pl on pl.id=t.plate_id
     join users u on u.id=pl.user_id
     where t.id=$1`, [ticketId]
  );
  return r.rows[0];
}

function buildMessages(kind, t) {
  const amount = (Number(t.balance_cents||0)/100).toFixed(2);
  const due = t.due_at ? new Date(t.due_at).toLocaleDateString('en-US') : 'N/A';
  const link = (process.env.SITE_URL || '') + `/ticket.html?t=${encodeURIComponent(t.ticket_no)}`;

  let sms = '';
  let subject = '';
  let text = '';

  if (kind === 'new') {
    sms = `New parking ticket for ${t.plate} (${t.state}). Amount $${amount}. Due ${due}. View: ${link} Reply STOP to cancel, HELP for help.`;
    subject = `New ticket on ${t.plate}`;
    text = `We found a new ticket ${t.ticket_no} for ${t.plate} (${t.state}). Amount $${amount}. Due ${due}.
Pay now: ${link}`;
  } else if (kind === '72h') {
    sms = `Reminder: ticket ${t.ticket_no} for ${t.plate} is due in 72 hours. Pay now: ${link}`;
    subject = `Ticket ${t.ticket_no} due in 72 hours`;
    text = `Heads up: ticket ${t.ticket_no} is due in 72 hours. Amount $${amount}.
Pay now: ${link}`;
  } else if (kind === 'due') {
    sms = `Due today: ticket ${t.ticket_no}. Avoid late fees. Pay now: ${link}`;
    subject = `Ticket ${t.ticket_no} due today`;
    text = `Today is the due date for ticket ${t.ticket_no}. Amount $${amount}.
Pay now: ${link}`;
  } else if (kind === 'paid') {
    subject = `Receipt for ticket ${t.ticket_no}`;
    text = `Thanks! We received your payment for ticket ${t.ticket_no}.`;
  }
  return { sms, subject, text };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const client = await pool.connect();
  try {
    const q = await client.query(
      `select id, user_id, plate_id, ticket_id, channel, kind
       from notifications
       where status='queued'
       order by created_at asc
       limit 100`
    );

    let sent = 0, failed = 0;
    for (const n of q.rows) {
      try {
        const t = await getTicket(client, n.ticket_id);
        const msg = buildMessages(n.kind, t);

        if (n.channel === 'email' && process.env.SENDGRID_API_KEY && t.email) {
          await fetch((process.env.SITE_URL || '') + '/api/send-email', {
            method: 'POST', headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ to: t.email, subject: msg.subject, text: msg.text + '\n\nUnsubscribe: ' + (process.env.SITE_URL || '') + '/prefs' })
          });
        } else if (n.channel === 'sms' && process.env.TWILIO_ACCOUNT_SID && t.phone) {
          const oo = await client.query('select 1 from sms_opt_out where phone=$1', [t.phone]);
          if (oo.rows.length === 0) {
            await fetch((process.env.SITE_URL || '') + '/api/send-sms', {
              method: 'POST', headers: { 'Content-Type':'application/json' },
              body: JSON.stringify({ to: t.phone, body: msg.sms })
            });
          } else {
            await client.query('update notifications set status=$1 where id=$2', ['opted_out', n.id]);
            continue;
          }
        }

        await client.query('update notifications set status=$1, sent_at=now() where id=$2', ['sent', n.id]);
        sent++;
      } catch (e) {
        await client.query('update notifications set status=$1, error=$2 where id=$3', ['failed', e.message, n.id]);
        failed++;
      }
    }

    return json(res, 200, { ok: true, sent, failed });
  } catch (e) {
    return json(res, 500, { error: e.message });
  } finally {
    client.release();
  }
};
