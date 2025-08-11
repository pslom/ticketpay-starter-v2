// api/subscribe.js
const { Pool } = require('pg');
const { cors, json, parseBody } = require('./_util');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false, error:'Method not allowed' });

  try {
    const { plate, state, city, email, phone, consent_sms } = await parseBody(req);

    if (!plate || !state || !city) return json(res, 400, { ok:false, error:'plate, state, city are required' });
    if (!email && !phone) return json(res, 400, { ok:false, error:'Provide email or phone' });
    if (phone && !consent_sms) return json(res, 400, { ok:false, error:'SMS consent required' });

    const client = await pool.connect();
    try {
      await client.query('begin');

      // upsert user
      let userId;
      if (email) {
        const r = await client.query(
          `insert into users(email) values($1)
           on conflict(email) do update set email=excluded.email
           returning id`,
          [email.toLowerCase()]
        );
        userId = r.rows[0].id;
      }
      if (!userId && phone) {
        const r = await client.query(
          `insert into users(phone) values($1)
           on conflict(phone) do update set phone=excluded.phone
           returning id`,
          [phone]
        );
        userId = r.rows[0].id;
      }

      // upsert plate
      const p = await client.query(
        `insert into plates(user_id, plate, state, city, consent_sms_at, consent_email_at)
         values($1,$2,$3,$4,$5,$6)
         on conflict (user_id, plate, state, city) do update set is_active=true
         returning id`,
        [
          userId,
          plate.trim().toUpperCase(),
          state.trim().toUpperCase(),
          city.trim().toLowerCase(),
          phone && consent_sms ? new Date() : null,
          email ? new Date() : null
        ]
      );
      const plateId = p.rows[0].id;

      await client.query(
        `insert into alert_prefs(user_id, plate_id, email_enabled, sms_enabled, remind_72h, remind_due)
         values($1,$2,$3,$4,true,true)
         on conflict do nothing`,
        [userId, plateId, !!email, !!phone]
      );

      await client.query('commit');
      return json(res, 200, { ok:true });
    } catch (e) {
      await client.query('rollback');
      return json(res, 500, { ok:false, error: e.message });
    } finally {
      client.release();
    }
  } catch (e) {
    return json(res, 500, { ok:false, error: e.message });
  }
};
