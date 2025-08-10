# TicketPay Starter (Carrd → Vercel → Postgres) — v2

This version adds a Postgres schema, seed data, and two new endpoints:

- `GET /api/tickets` — Look up a ticket by `ticket_no` or `id`
- `POST /api/pay` — Mock payment endpoint that marks a ticket as paid and inserts a payment row

It keeps the earlier messaging endpoints:
- `POST /api/send-email` (SendGrid)
- `POST /api/send-sms` (Twilio)

## Quick Start (beginner-friendly)

### 0) What you need
- Carrd Pro (for custom forms or code)
- A Vercel account
- A Supabase project (free is fine)

### 1) Create the database (Supabase)
1. Create a Supabase project. Copy the **Connection String** (starts with `postgresql://...`).
2. In **SQL Editor**, paste the contents of `db/schema.sql` and run it.
3. Then paste `db/seed.sql` and run it to add sample customers, tickets, and payments.

### 2) Deploy backend to Vercel
1. Put these files in a new GitHub repo (or download the zip and upload).
2. In Vercel: **New Project → Import** the repo → **Deploy**.
3. In Vercel → Project → **Settings → Environment Variables**, set:
   - `DATABASE_URL` = your Supabase connection string
   - `ALLOWED_ORIGIN` = your Carrd site origin (e.g. https://yourname.carrd.co)
   - `API_KEY` = any secret string you choose
   - `SENDGRID_API_KEY`, `FROM_EMAIL` (optional for email tests)
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (optional for SMS tests)
4. Click **Deploy** again to apply vars.

### 3) Hook up Carrd (staging)
- Ticket lookup form → `GET /api/tickets?ticket_no=ABC123` (use an Embed + JS fetch or a redirect pattern)
- Pay form → `POST /api/pay` with `ticket_id` or `ticket_no` and `amount_cents`

Examples are in the README bottom.

### 4) Test
- Use a ticket from the seed data (e.g. TKT-1001..TKT-1020).
- Call `/api/tickets?ticket_no=TKT-1001` and confirm JSON.
- Call `/api/pay` with `{ ticket_no: "TKT-1001", amount_cents: 5000 }` and see it mark as paid.

---

## Carrd embed examples

### Lookup (Embed → Code)
```html
<div>
  <input id="lookup" placeholder="Enter ticket number" />
  <button id="go">Lookup</button>
  <pre id="out"></pre>
</div>
<script>
  const API = "https://<your-vercel-deployment>/api/tickets";
  const KEY = "<your API_KEY>";
  document.getElementById('go').addEventListener('click', async () => {
    const t = document.getElementById('lookup').value.trim();
    const url = API + "?ticket_no=" + encodeURIComponent(t);
    const res = await fetch(url, { headers: { "x-api-key": KEY }});
    const data = await res.json();
    document.getElementById('out').textContent = JSON.stringify(data, null, 2);
  });
</script>
```

### Pay (Embed → Code)
```html
<div>
  <input id="ticket" placeholder="Ticket number" />
  <input id="amount" type="number" placeholder="Amount (cents)" />
  <button id="pay">Pay (mock)</button>
  <pre id="out2"></pre>
</div>
<script>
  const API = "https://<your-vercel-deployment>/api/pay";
  const KEY = "<your API_KEY>";
  document.getElementById('pay').addEventListener('click', async () => {
    const ticket = document.getElementById('ticket').value.trim();
    const amount = parseInt(document.getElementById('amount').value, 10) || 0;
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY },
      body: JSON.stringify({ ticket_no: ticket, amount_cents: amount })
    });
    const data = await res.json();
    document.getElementById('out2').textContent = JSON.stringify(data, null, 2);
  });
</script>
```

## Troubleshooting
- 401 Unauthorized → Ensure `x-api-key` matches your Vercel `API_KEY`, or include `apiKey` in body.
- 403/500 from DB → Check `DATABASE_URL` is correct and reachable.
- CORS error → Ensure `ALLOWED_ORIGIN` matches your Carrd origin exactly.

