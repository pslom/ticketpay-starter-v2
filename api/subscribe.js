// api/subscribe.js
const { Pool } = require('pg');
const crypto = require('crypto');

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

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const { plate, state, city, email, sms, consent_sms } = req.body || {};
    if (!plate || !state || !city) return json(res, 400, { error: 'plate, state, and city are required' });
    if (!email && !sms) return json(res, 400, { error: 'Provide at least one contact: email or sms' });
    if (sms && !consent_sms) return json(res, 400, { error: 'SMS consent is required for text alerts' });

    const client = await pool.connect();
    try {
      await client.query('begin');

      // upsert user by email/phone (simple path)
      let userId = null;
      if (email) {
        const u = await client.query(
          'insert into users(email) values($1) on conflict(email) do update set email=excluded.email returning id',
          [email.toLowerCase()]
        );
        userId = u.rows[0].id;
      }
      if (!userId && sms) {
        const u = await client.query(
          'insert into users(phone) values($1) on conflict(phone) do update set phone=excluded.phone returning id',
          [sms]
        );
        userId = u.rows[0].id;
      }

      const p = await client.query(
        `insert into plates(user_id, plate, state, city, consent_sms_at, consent_email_at)
         values($1,$2,$3,$4,$5,$6)
         on conflict (user_id, plate, state, city) do update set is_active=true
         returning id`,
        [userId, plate.trim().toUpperCase(), state.trim().toUpperCase(), city.trim().toLowerCase(),
         sms && consent_sms ? new Date() : null, email ? new Date() : null]
      );
      const plateId = p.rows[0].id;

      await client.query(
        `insert into alert_prefs(user_id, plate_id, email_enabled, sms_enabled, remind_72h, remind_due)
         values($1,$2,$3,$4,true,true)
         on conflict do nothing`,
        [userId, plateId, !!email, !!sms]
      );

      // magic link
      const token = crypto.randomBytes(18).toString('hex');
      const expires = new Date(Date.now() + 15 * 60 * 1000);
      await client.query(
        `insert into magic_links(user_id, token, expires_at) values($1,$2,$3)`,
        [userId, token, expires]
      );

      await client.query('commit');

      // Welcome email
      if (email && process.env.SITE_URL && process.env.SENDGRID_API_KEY) {
        const manageUrl = `${process.env.SITE_URL}/manage.html?token=${token}`;
        try {
          await fetch(`${process.env.SITE_URL}/api/send-email`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: email,
              subject: 'TicketPay: Plate added',
              text: `We’re watching ${plate.toUpperCase()} (${state.toUpperCase()}) in ${city}.
You’ll get alerts here. Manage settings: ${manageUrl}`
            })
          });
        } catch {}
      }

      // Welcome SMS
      if (sms && consent_sms && process.env.TWILIO_ACCOUNT_SID) {
        try {
          await fetch(`${process.env.SITE_URL}/api/send-sms`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: sms,
              body: `TicketPay: We’ll alert you for new tickets and due dates for ${plate.toUpperCase()} (${state.toUpperCase()}). Reply STOP to cancel, HELP for help.`
            })
          });
        } catch {}
      }

      return json(res, 200, { ok: true });
    } catch (e) {
      await client.query('rollback');
      return json(res, 500, { error: e.message });
    } finally {
      client.release();
    }
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
};
