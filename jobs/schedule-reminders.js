// api/jobs/schedule-reminders.js
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

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const client = await pool.connect();
  try {
    const r72 = await client.query(
      `select t.id as ticket_id, t.plate_id, p.user_id
       from tickets t
       join plates p on p.id=t.plate_id
       join alert_prefs ap on ap.plate_id=p.id
       where t.status='open' and t.due_at = (current_date + interval '3 day')::date
         and ap.remind_72h = true`
    );
    for (const r of r72.rows) {
      await client.query(
        `insert into notifications(user_id, plate_id, ticket_id, channel, kind, status)
         select $1, $2, $3, 'email', '72h', 'queued' where exists
           (select 1 from alert_prefs ap where ap.plate_id=$2 and ap.email_enabled=true);
         insert into notifications(user_id, plate_id, ticket_id, channel, kind, status)
         select $1, $2, $3, 'sms', '72h', 'queued' where exists
           (select 1 from alert_prefs ap where ap.plate_id=$2 and ap.sms_enabled=true);`,
        [r.user_id, r.plate_id, r.ticket_id]
      );
    }

    const dueToday = await client.query(
      `select t.id as ticket_id, t.plate_id, p.user_id
       from tickets t
       join plates p on p.id=t.plate_id
       join alert_prefs ap on ap.plate_id=p.id
       where t.status='open' and t.due_at = current_date
         and ap.remind_due = true`
    );
    for (const r of dueToday.rows) {
      await client.query(
        `insert into notifications(user_id, plate_id, ticket_id, channel, kind, status)
         select $1, $2, $3, 'email', 'due', 'queued' where exists
           (select 1 from alert_prefs ap where ap.plate_id=$2 and ap.email_enabled=true);
         insert into notifications(user_id, plate_id, ticket_id, channel, kind, status)
         select $1, $2, $3, 'sms', 'due', 'queued' where exists
           (select 1 from alert_prefs ap where ap.plate_id=$2 and ap.sms_enabled=true);`,
        [r.user_id, r.plate_id, r.ticket_id]
      );
    }

    return json(res, 200, { ok: true, queued_72h: r72.rowCount, queued_due: dueToday.rowCount });
  } catch (e) {
    return json(res, 500, { error: e.message });
  } finally {
    client.release();
  }
};
