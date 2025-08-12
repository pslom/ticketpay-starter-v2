// api/migrate.js
import { q } from "./_db.js";

const SQL = `
CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  ticket_number TEXT UNIQUE,
  plate TEXT,
  state TEXT,
  amount_cents INT,
  due_date TIMESTAMPTZ,
  status TEXT,
  violation_code TEXT,
  violation_desc TEXT,
  issued_at TIMESTAMPTZ,
  location TEXT,
  officer TEXT,
  paid_at TIMESTAMPTZ,
  receipt_id TEXT,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscribers (
  id SERIAL PRIMARY KEY,
  plate TEXT,
  state TEXT,
  phone TEXT,
  opted_out BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_phone ON subscribers(phone);
CREATE INDEX IF NOT EXISTS idx_sub_plate_state ON subscribers(plate, state);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT,
  phone TEXT,
  ticket_number TEXT,
  message TEXT,
  meta_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_sent (
  id SERIAL PRIMARY KEY,
  phone TEXT,
  ticket_number TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (req.headers["x-admin-key"] !== process.env.ADMIN_TASK_KEY) return res.status(403).end();
  try {
    await q(SQL);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
