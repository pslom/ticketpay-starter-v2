// api/jobs/poll-city.js
const { Pool } = require('pg');
const fetch = global.fetch;

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

// TODO: Implement a real DC adapter
async function fetchTicketsForPlate(city, plate, state) {
  // Return items shaped as:
  // [{ ticket_no, issued_at, due_at, amount_cents, status, raw }]
  if (city === 'dc') {
    // Example: make a GET to DC open data and filter by plate+state if available
    // const url = `https://opendata.dc.gov/...`;
    // const r = await fetch(url);
    // const data = await r.json();
    // return data.map(d => ({ ticket_no: d.ticket, issued_at: d.issue_date, ... }));
  }
  return [];
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const city = (req.query.city || req.body?.city || '').toLowerCase();
  if (!city) return json(res, 400, { error: 'city is required (e.g. dc)' });

  const client = await pool.connect();
  try {
    const plates = await client.query(
      `select p.id, p.plate, p.state, p.city, p.user_id
       from plates p
       where p.is_active = true and p.city = $1`,
      [city]
    );

    let newCount = 0;
    for (const row of plates.rows) {
      const items = await fetchTicketsForPlate(city, row.plate, row.state);
      for (const t of items) {
        const existing = await client.query(
          `select id, status, balance_cents from tickets where plate_id=$1 and ticket_no=$2`,
          [row.id, t.ticket_no]
        );
        if (existing.rows.length === 0) {
          const ins = await client.query(
            `insert into tickets(plate_id, ticket_no, issued_at, due_at, balance_cents, status, source, raw)
             values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
            [row.id, t.ticket_no, t.issued_at, t.due_at, t.amount_cents, t.status, city, t.raw || null]
          );
          const ticketId = ins.rows[0].id;
          newCount++;

          await client.query(
            `insert into notifications(user_id, plate_id, ticket_id, channel, kind, status)
             select $1, $2, $3, 'email', 'new', 'queued' where exists
               (select 1 from alert_prefs ap where ap.plate_id=$2 and ap.email_enabled=true);
             insert into notifications(user_id, plate_id, ticket_id, channel, kind, status)
             select $1, $2, $3, 'sms', 'new', 'queued' where exists
               (select 1 from alert_prefs ap where ap.plate_id=$2 and ap.sms_enabled=true);`,
            [row.user_id, row.id, ticketId]
          );
        } else {
          const ex = existing.rows[0];
          if (ex.status !== t.status || ex.balance_cents !== t.amount_cents) {
            await client.query(
              `update tickets set status=$1, balance_cents=$2, updated_at=now() where plate_id=$3 and ticket_no=$4`,
              [t.status, t.amount_cents, row.id, t.ticket_no]
            );
          }
        }
      }
    }

    return json(res, 200, { ok: true, city, new: newCount });
  } catch (e) {
    return json(res, 500, { error: e.message });
  } finally {
    client.release();
  }
};
