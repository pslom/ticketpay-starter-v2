// api/router.js — single Serverless Function for all endpoints
// Drop this file into /api/router.js and deploy on Vercel.
// Requires env: DATABASE_URL, SITE_URL, STRIPE_SECRET_KEY, (optional) STRIPE_WEBHOOK_SECRET,
//               TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, (optional) SMS_DEEP_LINK_SECRET

const { URL } = require('url');
const crypto = require('crypto');
const { Pool } = require('pg');
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });
const twilio = require('twilio');

let _pool;
function pool() {
if (!_pool) {
_pool = new Pool({
connectionString: process.env.DATABASE_URL,
max: 5,
idleTimeoutMillis: 30000,
});
}
return _pool;
}

function json(res, code, obj) {
res.statusCode = code;
res.setHeader('content-type', 'application/json');
res.end(JSON.stringify(obj));
}
function text(res, code, msg) {
res.statusCode = code;
res.setHeader('content-type', 'text/plain');
res.end(msg);
}
function readBody(req) {
return new Promise((resolve) => {
let d = '';
req.on('data', (c) => (d += c));
req.on('end', () => resolve(d));
});
}
function e164(s = '') {
s = String(s).replace(/[^0-9+]/g, '').replace(/^00/, '+');
if (!s) return '';
if (!s.startsWith('+')) {
if (s.length === 10) return '+1' + s; // assume US
if (s.length === 11 && s.startsWith('1')) return '+' + s;
}
return s;
}
function hmacSign(path, data = '') {
const sec = process.env.SMS_DEEP_LINK_SECRET || 'dev-secret';
return crypto.createHmac('sha256', sec).update(path + '|' + data).digest('hex');
}

// --- Schema management ------------------------------------------------------
async function ensureSchema(client) {
// Core tables
await client.query(`
CREATE TABLE IF NOT EXISTS subscribers (
id SERIAL PRIMARY KEY,
plate TEXT,
state TEXT,
phone TEXT,
created_at TIMESTAMPTZ DEFAULT now(),
opted_out BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_sub_phone ON subscribers(phone);
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  plate TEXT,
  state TEXT,
  amount_cents INT,
  due_date TIMESTAMPTZ,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Make sure ticket_number column exists (older deployments may miss it)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_number TEXT;

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

// Backfill any missing/blank ticket_number values so lookups work immediately
await client.query(    UPDATE tickets t
      SET ticket_number = CONCAT(
        COALESCE(NULLIF(t.state, ''), 'TKT'), '-',
        to_char(COALESCE(t.created_at, now()), 'YYYYMMDD'), '-',
        t.id::text
      )
      WHERE (t.ticket_number IS NULL OR t.ticket_number = '') AND t.id IS NOT NULL;
 );

// Ensure UNIQUE constraint on ticket_number (guarded)
await client.query(    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tickets'::regclass AND conname = 'tickets_ticket_number_key'
      ) THEN
        BEGIN
          ALTER TABLE tickets ADD CONSTRAINT tickets_ticket_number_key UNIQUE (ticket_number);
        EXCEPTION WHEN others THEN
          -- If duplicates exist, ignore; app still functions with lookups.
          NULL;
        END;
      END IF;
    END$$;
 );
}

async function logEvent(client, { type, phone = null, ticket = null, message = null, meta = null }) {
try {
await client.query(
INSERT INTO audit_log (event_type, phone, ticket_number, message, meta_json) VALUES ($1,$2,$3,$4,$5),
[type, phone, ticket, message, meta || null]
);
} catch (_) {}
}

// SMS via Twilio (optional in dev)
function getTwilio() {
const sid = process.env.TWILIO_ACCOUNT_SID;
const tok = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_FROM_NUMBER;
if (!sid || !tok || !from) return null;
return { client: twilio(sid, tok), from };
}
async function sendSMS(to, body) {
const T = getTwilio();
if (!T) { console.log('[DEV SMS]', to, body); return { dev: true }; }
try { return await T.client.messages.create({ to, from: T.from, body }); }
catch (e) { console.error('[SMS ERR]', e?.message); throw e; }
}
function verifyTwilioSig(req, bodyParams) {
const sig = req.headers['x-twilio-signature'];
const tok = process.env.TWILIO_AUTH_TOKEN;
if (!sig || !tok) return true; // allow in dev
const url = https://${req.headers.host}${req.url};
return twilio.validateRequest(tok, sig, url, bodyParams);
}

// --- Handlers ---------------------------------------------------------------
async function handleHealth(_req, res) {
json(res, 200, { ok: true, ts: new Date().toISOString() });
}

// Lookup tickets either by { ticket_number } OR { plate, state }. Optional { phone } subscribes.
async function handleLookup(req, res, body) {
const ct = req.headers['content-type'] || '';
let data = {};
if (ct.includes('application/json')) { try { data = JSON.parse(body || '{}'); } catch {}
} else if (ct.includes('application/x-www-form-urlencoded')) { data = Object.fromEntries(new URLSearchParams(body)); }

const ticketNumber = (data.ticket_number || '').trim();
const plate = (data.plate || '').trim().toUpperCase();
const state = (data.state || '').trim().toUpperCase();
const phone = e164(data.phone || '');

if (!ticketNumber && !(plate && state)) {
return text(res, 400, 'Provide either {ticket_number} or {plate,state}');
}

const client = await pool().connect();
try {
await ensureSchema(client);
let tickets = [];
if (ticketNumber) {
  const r = await client.query(
    `SELECT ticket_number, plate, state, amount_cents, due_date, status
     FROM tickets WHERE ticket_number=$1 LIMIT 1`,
    [ticketNumber]
  );
  tickets = r.rows.length ? [r.rows[0]] : [];
} else {
  const r = await client.query(
    `SELECT ticket_number, plate, state, amount_cents, due_date, status
     FROM tickets WHERE plate=$1 AND state=$2 ORDER BY created_at DESC`,
    [plate, state]
  );
  tickets = r.rows;

  if (phone) {
    // Insert subscriber if not exists (no unique index required)
    await client.query(
      `INSERT INTO subscribers(plate, state, phone)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM subscribers WHERE plate=$1 AND state=$2 AND phone=$3
       )`,
      [plate, state, phone]
    );
    await logEvent(client, { type: 'opt_in', phone, message: `Opt-in for ${plate} ${state}` });
    try { await sendSMS(phone, `TicketPay: You’re opted in for alerts on ${plate} ${state}. Reply STOP to opt out.`); } catch {}
  }
}

json(res, 200, { tickets, plate, state, ticket_number: ticketNumber });
} catch (e) {
console.error('lookup error', e);
text(res, 500, 'error');
} finally { client.release(); }
}

// Create Stripe Checkout session for a ticket_number
async function handleCreateCheckout(req, res, body) {
const ct = req.headers['content-type'] || '';
let data = {};
if (ct.includes('application/json')) { try { data = JSON.parse(body || '{}'); } catch {}
} else if (ct.includes('application/x-www-form-urlencoded')) { data = Object.fromEntries(new URLSearchParams(body)); }
const tnum = (data.ticket_number || '').trim();
if (!tnum) { return text(res, 400, 'ticket_number required'); }

if (!process.env.STRIPE_SECRET_KEY) { return text(res, 500, 'Stripe not configured'); }

const client = await pool().connect();
try {
await ensureSchema(client);
const r = await client.query(
SELECT ticket_number, plate, state, amount_cents, status
       FROM tickets WHERE ticket_number=$1 LIMIT 1,
[tnum]
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
} finally { client.release(); }
}

// Stripe webhook: mark tickets paid
async function handleStripeWebhook(req, res, body) {
const sig = req.headers['stripe-signature'];
const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
let event = null;
if (whSecret) {
try { event = stripe.webhooks.constructEvent(body, sig, whSecret); }
catch (err) { return text(res, 400, 'Invalid signature'); }
} else {
try { event = JSON.parse(body); } catch { return text(res, 400, 'Bad JSON'); }
}

const client = await pool().connect();
try {
await ensureSchema(client);
if (event.type === 'checkout.session.completed') {
const obj = event.data.object || {};
const tnum = obj?.metadata?.ticket_number;
if (tnum) {
await client.query(UPDATE tickets SET status='paid' WHERE ticket_number=$1, [tnum]);
await logEvent(client, { type: 'stripe_paid', ticket: tnum, message: 'checkout.session.completed' });
}
} else if (event.type === 'payment_intent.succeeded') {
const obj = event.data.object || {};
const tnum = obj?.metadata?.ticket_number;
if (tnum) {
await client.query(UPDATE tickets SET status='paid' WHERE ticket_number=$1, [tnum]);
await logEvent(client, { type: 'stripe_paid', ticket: tnum, message: 'payment_intent.succeeded' });
}
}
text(res, 200, 'ok');
} catch (e) {
console.error('stripe webhook error', e);
text(res, 500, 'error');
} finally { client.release(); }
}

// Twilio inbound webhook (STOP/START/HELP). Website‑first default.
async function handleTwilioWebhook(req, res, body) {
const params = Object.fromEntries(new URLSearchParams(body || ''));
if (!verifyTwilioSig(req, params)) return text(res, 403, 'Forbidden');

const from = e164(params.From || '');
const bodyText = String(params.Body || '').trim();
const upper = bodyText.toUpperCase();

const client = await pool().connect();
try {
await ensureSchema(client);
await logEvent(client, { type: 'sms_in', phone: from, message: bodyText });
if (upper === 'STOP' || upper === 'UNSUBSCRIBE') {
  await client.query(`UPDATE subscribers SET opted_out=true WHERE phone=$1`, [from]);
  await sendSMS(from, 'You’ve been unsubscribed. Reply START to rejoin.');
  return text(res, 200, 'OK');
}
if (upper === 'START' || upper === 'UNSTOP') {
  await client.query(`UPDATE subscribers SET opted_out=false WHERE phone=$1`, [from]);
  await sendSMS(from, 'You’re now subscribed to ticket updates.');
  return text(res, 200, 'OK');
}
if (upper === 'HELP') {
  await sendSMS(from, 'TicketPay Help: Reply STOP to opt out. Visit https://www.ticketpay.us.com');
  return text(res, 200, 'OK');
}

// If not a known subscriber, point them to the site (website‑first)
const known = await client.query(`SELECT 1 FROM subscribers WHERE phone=$1 AND opted_out=false LIMIT 1`, [from]);
if (known.rowCount === 0) {
  await sendSMS(from, 'Visit https://www.ticketpay.us.com to securely look up and pay your ticket.');
  return text(res, 200, 'OK');
}

// Minimal parser: "STATE PLATE" → reply with link
const parts = upper.split(/\s+/);
if (parts.length >= 2) {
  const state = parts[0];
  const plate = parts.slice(1).join('');
  await sendSMS(from, `Tickets for ${plate} ${state}: https://www.ticketpay.us.com/?state=${state}&plate=${plate}`);
  return text(res, 200, 'OK');
}

await sendSMS(from, 'Unrecognized command. Send HELP for options.');
text(res, 200, 'OK');
} catch (e) {
console.error('twilio webhook error', e);
text(res, 500, 'error');
} finally { client.release(); }
}

// Simple scheduled tasks (optional). Safe no-ops if Twilio not configured.
async function handleDueReminders(req, res) {
const client = await pool().connect();
try {
await ensureSchema(client);
const r = await client.query(      SELECT t.ticket_number, t.plate, t.state, t.due_date, s.phone
      FROM tickets t
      JOIN subscribers s ON s.plate=t.plate AND s.state=t.state AND s.opted_out=false
      WHERE t.status IS DISTINCT FROM 'paid' AND t.due_date BETWEEN now() AND now() + interval '48 hours'
   );
let sent = 0;
for (const row of r.rows) {
try {
const msg = Reminder: ticket ${row.ticket_number} due ${new Date(row.due_date).toLocaleDateString('en-US', { month:'short', day:'numeric' })}. Pay: ${(process.env.SITE_URL||'')}/pay/${row.ticket_number}?sig=${hmacSign('/pay', row.ticket_number)};
await sendSMS(row.phone, msg);
sent++;
} catch () {}
}
json(res, 200, { queued: sent });
} finally { client.release(); }
}

async function handlePastDue(req, res) {
const client = await pool().connect();
try {
await ensureSchema(client);
const r = await client.query(      SELECT t.ticket_number, t.plate, t.state, t.due_date, s.phone
      FROM tickets t
      JOIN subscribers s ON s.plate=t.plate AND s.state=t.state AND s.opted_out=false
      WHERE t.status IS DISTINCT FROM 'paid' AND t.due_date < now() AND t.due_date > now() - interval '1 day'
   );
let sent = 0;
for (const row of r.rows) {
try {
const msg = Ticket ${row.ticket_number} is past due. Pay: ${(process.env.SITE_URL||'')}/pay/${row.ticket_number};
await sendSMS(row.phone, msg);
sent++;
} catch () {}
}
json(res, 200, { queued: sent });
} finally { client.release(); }
}

// --- Router ----------------------------------------------------------------
module.exports = async (req, res) => {
const { pathname } = new URL(req.url, http://${req.headers.host});
const method = req.method || 'GET';
const body = method === 'GET' ? '' : await readBody(req);

if (method === 'GET'  && pathname === '/api/health') return handleHealth(req, res);
if (method === 'POST' && pathname === '/api/lookup') return handleLookup(req, res, body);
if (method === 'POST' && pathname === '/api/pay') return handleCreateCheckout(req, res, body);
if (method === 'POST' && pathname === '/api/webhooks/stripe') return handleStripeWebhook(req, res, body);
if (method === 'POST' && pathname === '/api/webhooks/twilio') return handleTwilioWebhook(req, res, body);
if (method === 'POST' && pathname === '/api/tasks/send_due_reminders') return handleDueReminders(req, res);
if (method === 'POST' && pathname === '/api/tasks/send_past_due') return handlePastDue(req, res);

// Minimal admin endpoint to keep logs page alive if you had one before
if (method === 'GET'  && pathname === '/api/admin/sms-log') return text(res, 200, '[]');

res.statusCode = 404; res.end('Not found');
};
