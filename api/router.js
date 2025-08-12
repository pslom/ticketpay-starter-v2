// api/router.js — single Serverless Function handling all API routes on Vercel
// Requires deps in package.json: pg, stripe, twilio
// Env needed in Vercel (Production):
//   DATABASE_URL
//   SITE_URL (e.g. https://www.ticketpay.us.com)
//   ALLOWED_ORIGIN (e.g. https://www.ticketpay.us.com)
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER
//   TASK_KEY  (random string for cron endpoints)
//   SMS_DEEP_LINK_SECRET (optional; for signed links)

const { URL } = require('url');
const crypto = require('crypto');
const { Pool } = require('pg');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });
const twilio = require('twilio');

// ---------- utils ----------
let _pool;
function pool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 30000 });
  }
  return _pool;
}
function json(res, code, obj) { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); }
function text(res, code, msg) { res.statusCode = code; res.setHeader('content-type', 'text/plain'); res.end(msg); }
function readBody(req) { return new Promise((resolve)=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>resolve(d)); }); }
function e164(s=''){ return String(s).replace(/[^0-9+]/g,'').replace(/^00/,'+'); }
function hmacSign(path, payload='') { const sec = process.env.SMS_DEEP_LINK_SECRET || 'dev-secret'; return crypto.createHmac('sha256', sec).update(path + '|' + payload).digest('hex'); }

function allowedOrigin(req) {
  const allowed = (process.env.ALLOWED_ORIGIN || '').trim(); // e.g. https://www.ticketpay.us.com
  if (!allowed) return true; // if not set, allow
  const origin = req.headers.origin || '';
  const ref = req.headers.referer || '';
  return origin.startsWith(allowed) || ref.startsWith(allowed);
}

// ---------- schema & logging ----------
async function ensureSchema(client) {
  await client.query(`
    -- Subscribers (unchanged)
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      plate TEXT,
      state TEXT,
      phone TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      opted_out BOOLEAN DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_sub_phone ON subscribers(phone);

    -- Tickets: ensure table exists
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      plate TEXT,
      state TEXT,
      amount_cents INT,
      due_date TIMESTAMPTZ,
      status TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Ensure ticket_number column exists
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_number TEXT;

    -- Ensure uniqueness on ticket_number (ignore if it already exists)
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tickets'::regclass
          AND conname = 'tickets_ticket_number_key'
      ) THEN
        ALTER TABLE tickets
        ADD CONSTRAINT tickets_ticket_number_key UNIQUE (ticket_number);
      END IF;
    END$$;

    -- Audit + SMS tables
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      event_type TEXT,
      phone TEXT,
      ticket_number TEXT,
      message TEXT,
      meta_json JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sms_sent (
      id SERIAL PRIMARY KEY,
      phone TEXT,
      ticket_number TEXT,
      sent_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sms_sent_recent ON sms_sent(phone, ticket_number, sent_at);
  `);

  // Backfill any missing/blank ticket_number values with a deterministic value
  // Format: STATE-YYYYMMDD-ID (fallback TKT if state missing)
  await client.query(`
    UPDATE tickets t
      SET ticket_number = COALESCE(ticket_number, '')
      WHERE ticket_number IS NULL;

    UPDATE tickets t
      SET ticket_number = CONCAT(
        COALESCE(NULLIF(t.state, ''), 'TKT'), '-',
        to_char(COALESCE(t.created_at, now()), 'YYYYMMDD'), '-',
        t.id::text
      )
      WHERE (t.ticket_number = '' OR t.ticket_number IS NULL)
        AND t.id IS NOT NULL;
  `);
}

async function logEvent(client, { type, phone=null, ticket=null, message=null, meta=null }) {
  await client.query(
    `INSERT INTO audit_log (event_type, phone, ticket_number, message, meta_json) VALUES ($1,$2,$3,$4,$5)`,
    [type, phone, ticket, message, meta || null]
  );
}

function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !tok || !from) return null;
  return { client: twilio(sid, tok), from };
}

async function canSendSMS(client, phone, ticket) {
  // rate limit: 1 per 24h per (phone, ticket)
  if (!ticket) return true;
  const r = await client.query(
    `SELECT 1 FROM sms_sent WHERE phone=$1 AND ticket_number=$2 AND sent_at > now() - interval '24 hours' LIMIT 1`,
    [phone, ticket]
  );
  return r.rowCount === 0;
}

async function sendSMS(client, to, body, ticketNumber=null) {
  const T = getTwilio();
  if (!T) { console.log('[DEV SMS]', to, body); await logEvent(client, { type:'sms_out_dev', phone: to, ticket: ticketNumber, message: body }); return { dev: true }; }
  // check rate limit
  if (ticketNumber) {
    const ok = await canSendSMS(client, to, ticketNumber);
    if (!ok) { await logEvent(client, { type:'sms_skipped_rate', phone: to, ticket: ticketNumber, message: body }); return { skipped: true }; }
  }
  try {
    const resp = await T.client.messages.create({ to, from: T.from, body });
    await client.query(`INSERT INTO sms_sent (phone, ticket_number) VALUES ($1,$2)`, [to, ticketNumber]);
    await logEvent(client, { type:'sms_out', phone: to, ticket: ticketNumber, message: body, meta: { sid: resp.sid } });
    return resp;
  } catch (e) {
    await logEvent(client, { type:'sms_out_err', phone: to, ticket: ticketNumber, message: e?.message || String(e) });
    throw e;
  }
}

function verifyTwilioSig(req, bodyParams) {
  const sig = req.headers['x-twilio-signature'];
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sig || !tok) return true; // allow in dev / manual curl tests
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${req.headers.host}${req.url}`;
  return twilio.validateRequest(tok, sig, url, bodyParams);
}

function requireTaskKey(req) {
  const need = process.env.TASK_KEY || '';
  if (!need) return true; // if not set, allow (dev)
  return (req.headers['x-task-key'] || '') === need;
}

// ---------- handlers ----------
async function handleHealth(req, res) {
  json(res, 200, { ok: true, ts: new Date().toISOString() });
}

/**
 * /api/lookup
 * Modes:
 *  - { plate, state, phone? }
 *  - { ticket_number }
 */
async function handleLookup(req, res, body) {
  if (!allowedOrigin(req)) return text(res, 403, 'Forbidden');
  const ct = req.headers['content-type'] || '';
  let data = {};
  if (ct.includes('application/json')) { try { data = JSON.parse(body || '{}'); } catch {} }
  else if (ct.includes('application/x-www-form-urlencoded')) { data = Object.fromEntries(new URLSearchParams(body)); }

  const ticketNumber = (data.ticket_number || '').trim();
  const plate = (data.plate||'').trim().toUpperCase();
  const state = (data.state||'').trim().toUpperCase();
  const phone = e164(data.phone||'');

  const client = await pool().connect();
  try {
    await ensureSchema(client);
    let tickets = [];

    if (ticketNumber) {
      const r = await client.query(
        `SELECT ticket_number, plate, state, amount_cents, due_date, status
         FROM tickets WHERE ticket_number=$1 LIMIT 1`, [ticketNumber]
      );
      tickets = r.rows;
    } else if (plate && state) {
      const r = await client.query(
        `SELECT ticket_number, plate, state, amount_cents, due_date, status
         FROM tickets WHERE plate=$1 AND state=$2 ORDER BY created_at DESC`, [plate, state]
      );
      tickets = r.rows;

      if (phone) {
        await client.query(
          `INSERT INTO subscribers(plate,state,phone)
           VALUES($1,$2,$3)
           ON CONFLICT DO NOTHING`, [plate, state, phone]
        );
        await logEvent(client, { type:'sms_optin', phone, message:`Opt-in for ${plate} ${state}` });
        await sendSMS(client, phone, `TicketPay: You’re opted in for alerts on ${plate} ${state}. Reply STOP to opt out.`);
      }
    } else {
      return text(res, 400, 'Provide either {ticket_number} or {plate,state}');
    }

    json(res, 200, { tickets, plate, state, ticket_number: ticketNumber });
  } finally {
    client.release();
  }
}

// Create Stripe Checkout session for a ticket_number
async function handleCreateCheckout(req, res, body) {
  if (!allowedOrigin(req)) return text(res, 403, 'Forbidden');
  const ct = req.headers['content-type'] || '';
  let data = {};
  if (ct.includes('application/json')) { try { data = JSON.parse(body || '{}'); } catch {} }
  else if (ct.includes('application/x-www-form-urlencoded')) { data = Object.fromEntries(new URLSearchParams(body)); }
  const tnum = (data.ticket_number || '').trim();
  if (!tnum) { return text(res, 400, 'ticket_number required'); }

  const client = await pool().connect();
  try {
    await ensureSchema(client);
    const r = await client.query(
      `SELECT ticket_number, plate, state, amount_cents, status
       FROM tickets WHERE ticket_number=$1 LIMIT 1`, [tnum]
    );
    if (!r.rows.length) return text(res, 404, 'not found');
    const t = r.rows[0];
    if ((t.status || '').toLowerCase() === 'paid') return text(res, 409, 'already paid');

    const site = process.env.SITE_URL || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Parking Ticket ${t.ticket_number}` },
          unit_amount: Number(t.amount_cents || 0)
        },
        quantity: 1
      }],
      metadata: { ticket_number: t.ticket_number, plate: t.plate, state: t.state },
      payment_intent_data: { metadata: { ticket_number: t.ticket_number, plate: t.plate, state: t.state }},
      success_url: `${site}/success.html?tnum=${encodeURIComponent(t.ticket_number)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/cancel.html?tnum=${encodeURIComponent(t.ticket_number)}`
    });

    json(res, 200, { url: session.url });
  } catch (e) {
    console.error('pay error', e);
    text(res, 500, 'error');
  } finally {
    client.release();
  }
}

// Stripe webhook
async function handleStripeWebhook(req, res, rawBody) {
  let event = null;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  if (whSecret) {
    try { event = stripe.webhooks.constructEvent(rawBody, sig, whSecret); }
    catch (err) { return text(res, 400, 'Invalid signature'); }
  } else {
    try { event = JSON.parse(rawBody); } catch { return text(res, 400, 'Bad JSON'); }
  }

  const client = await pool().connect();
  try {
    await ensureSchema(client);

    if (event.type === 'checkout.session.completed') {
      const obj = event.data.object || {};
      const tnum = obj?.metadata?.ticket_number;
      const pi = obj.payment_intent;
      if (tnum && pi) {
        await client.query(`UPDATE tickets SET status='paid' WHERE ticket_number=$1`, [tnum]);
        await logEvent(client, { type:'stripe_paid', ticket: tnum, message: 'checkout.session.completed' });
      }
    }

    if (event.type === 'payment_intent.payment_failed' || event.type === 'checkout.session.async_payment_failed') {
      // Notify subscribers with a fresh resume link
      const obj = event.data.object || {};
      const md = obj?.metadata || {};
      const tnum = md.ticket_number;
      const plate = (md.plate || '').toUpperCase();
      const state = (md.state || '').toUpperCase();

      if (tnum && plate && state) {
        const site = process.env.SITE_URL || `https://${req.headers.host}`;
        // Create new checkout session to resume
        const tRow = await client.query(`SELECT amount_cents FROM tickets WHERE ticket_number=$1 LIMIT 1`, [tnum]);
        if (tRow.rows.length) {
          const amount = Number(tRow.rows[0].amount_cents || 0);
          const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            line_items: [{ price_data: { currency:'usd', product_data:{ name: `Parking Ticket ${tnum}` }, unit_amount: amount }, quantity: 1 }],
            metadata: { ticket_number: tnum, plate, state },
            payment_intent_data: { metadata: { ticket_number: tnum, plate, state }},
            success_url: `${site}/success.html?tnum=${encodeURIComponent(tnum)}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${site}/cancel.html?tnum=${encodeURIComponent(tnum)}`
          });

          const subs = await client.query(
            `SELECT phone FROM subscribers WHERE plate=$1 AND state=$2 AND opted_out=false`,
            [plate, state]
          );
          for (const row of subs.rows) {
            await sendSMS(client, row.phone, `Your payment didn’t complete for ticket ${tnum}. Resume: ${session.url}`, tnum);
          }
          await logEvent(client, { type:'stripe_failed_notify', ticket: tnum, message: `notified ${subs.rowCount} subs` });
        }
      }
    }

    text(res, 200, 'ok');
  } finally {
    client.release();
  }
}

// Twilio inbound webhook
async function handleTwilioWebhook(req, res, body) {
  const params = Object.fromEntries(new URLSearchParams(body));
  if (!verifyTwilioSig(req, params)) return text(res, 403, 'Forbidden');

  const from = e164(params.From || '');
  const bodyText = String(params.Body || '').trim();
  const upper = bodyText.toUpperCase();

  const client = await pool().connect();
  try {
    await ensureSchema(client);
    await logEvent(client, { type:'sms_in', phone: from, message: bodyText });

    if (upper === 'STOP' || upper === 'UNSUBSCRIBE') {
      await client.query(`UPDATE subscribers SET opted_out=true WHERE phone=$1`, [from]);
      await sendSMS(client, from, 'You’ve been unsubscribed. Reply START to rejoin.');
      return text(res, 200, 'OK');
    }
    if (upper === 'START' || upper === 'UNSTOP') {
      await client.query(`UPDATE subscribers SET opted_out=false WHERE phone=$1`, [from]);
      await sendSMS(client, from, 'You’re now subscribed to ticket updates.');
      return text(res, 200, 'OK');
    }
    if (upper === 'HELP') {
      await sendSMS(client, from, 'TicketPay Help: Reply STOP to opt out. Visit https://www.ticketpay.us.com/help');
      return text(res, 200, 'OK');
    }

    // Website-first: only allow lookup if phone previously subscribed
    const known = await client.query(`SELECT 1 FROM subscribers WHERE phone=$1 AND opted_out=false LIMIT 1`, [from]);
    if (known.rowCount === 0) {
      await sendSMS(client, from, 'Visit https://www.ticketpay.us.com to securely look up and pay your ticket.');
      return text(res, 200, 'OK');
    }

    // Parse "STATE PLATE"
    const parts = upper.split(/\s+/);
    if (parts.length >= 2) {
      const state = parts[0];
      const plate = parts.slice(1).join('');
      await sendSMS(client, from, `Tickets for ${plate} ${state}: https://www.ticketpay.us.com/?state=${state}&plate=${plate}`);
      return text(res, 200, 'OK');
    }

    await sendSMS(client, from, 'Unrecognized command. Send HELP for options.');
    text(res, 200, 'OK');
  } finally {
    client.release();
  }
}

// Reminders (require X-Task-Key auth)
async function handleDueReminders(req, res) {
  if (!requireTaskKey(req)) return text(res, 403, 'Forbidden');
  const client = await pool().connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`
      SELECT t.ticket_number, t.plate, t.state, t.due_date, s.phone
      FROM tickets t
      JOIN subscribers s ON s.plate=t.plate AND s.state=t.state AND s.opted_out=false
      WHERE (t.status IS NULL OR t.status <> 'paid')
        AND t.due_date BETWEEN now() AND now() + interval '48 hours'`);
    let sent = 0;
    for (const row of r.rows) {
      const msg = `Reminder: ticket ${row.ticket_number} due ${new Date(row.due_date).toLocaleDateString('en-US', { month:'short', day:'numeric' })}. Pay: ${(process.env.SITE_URL||'')}`;
      await sendSMS(client, row.phone, msg, row.ticket_number);
      sent++;
    }
    json(res, 200, { queued: sent });
  } finally {
    client.release();
  }
}

async function handlePastDue(req, res) {
  if (!requireTaskKey(req)) return text(res, 403, 'Forbidden');
  const client = await pool().connect();
  try {
    await ensureSchema(client);
    const r = await client.query(`
      SELECT t.ticket_number, t.plate, t.state, t.due_date, s.phone
      FROM tickets t
      JOIN subscribers s ON s.plate=t.plate AND s.state=t.state AND s.opted_out=false
      WHERE (t.status IS NULL OR t.status <> 'paid')
        AND t.due_date < now() AND t.due_date > now() - interval '1 day'`);
    let sent = 0;
    for (const row of r.rows) {
      const msg = `Ticket ${row.ticket_number} is past due. Pay: ${(process.env.SITE_URL||'')}`;
      await sendSMS(client, row.phone, msg, row.ticket_number);
      sent++;
    }
    json(res, 200, { queued: sent });
  } finally {
    client.release();
  }
}

// ---------- router ----------
module.exports = async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || 'GET';
  const body = method === 'GET' ? '' : await readBody(req);

  if (method === 'GET'  && pathname === '/api/health') return handleHealth(req, res);
  if (method === 'POST' && pathname === '/api/lookup') return handleLookup(req, res, body);
  if (method === 'POST' && pathname === '/api/pay') return handleCreateCheckout(req, res, body);
  if (method === 'POST' && pathname === '/api/webhooks/stripe') return handleStripeWebhook(req, res, body);
  if (method === 'POST' && pathname === '/api/webhooks/twilio') return handleTwilioWebhook(req, res, body);
  if (method === 'POST' && pathname === '/api/tasks/send_due_reminders') return handleDueReminders(req, res);
  if (method === 'POST' && pathname === '/api/tasks/send_past_due') return handlePastDue(req, res);

  if (method === 'GET'  && pathname === '/api/admin/sms-log') return text(res, 200, '[]');

  res.statusCode = 404; res.end('Not found');
};
