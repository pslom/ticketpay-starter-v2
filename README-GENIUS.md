# TicketPay “Genius Pack”
Updated: 2025-08-11 18:24 UTC

This pack replaces a few API files with production‑quality versions and adds a tiny home page.
Everything is **drop‑in**. No framework. Works on Vercel’s serverless functions.

## What you get
- `api/_util.js` – one place for CORS, JSON replies, body parsing, and auth.
- `api/tickets.js` – clean, fast ticket lookup by number or id.
- `api/create-checkout-session.js` – Stripe Checkout with an explicit service fee (2 line items).
- `api/send-email.js` – SendGrid wrapper with safe headers.
- `api/send-sms.js` – Twilio wrapper with simple error mapping.
- `api/stripe-webhook.js` – verifies signature, marks tickets paid, idempotent.
- `api/twilio-inbound.js` – STOP / HELP handling (no change if you already use it).
- `index.html` – optional landing to avoid a 404 on `/` and for quick sanity links.

## Required env vars (Vercel → Settings → Environment Variables)
- `DATABASE_URL`
- `SITE_URL` (e.g. `https://ticketpay-starter-v2.vercel.app`)
- `ALLOWED_ORIGIN` (e.g. `https://ticketpay.us.com`)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `SENDGRID_API_KEY`, `FROM_EMAIL`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- *(Optional)* `API_KEY` – if set, the API requires `x-api-key` on requests. If **unset**, endpoints are public.

## How to install
1. In GitHub, open your repo root and **replace** the files with the ones in this pack, same paths.
2. Keep your existing SQL; no schema change needed for this drop.
3. In Vercel, confirm build settings: **Framework = Other**, **Build Command = empty**, **Output Dir = empty**.
4. Set env vars above and **Redeploy**.
5. Sanity check in browser:
   - `https://YOUR-PROD.vercel.app/` → small index page
   - `https://YOUR-PROD.vercel.app/success.html`
   - `https://YOUR-PROD.vercel.app/api/tickets?ticket_no=TKT-1001` → JSON
6. In Carrd, set in your code block:
   ```js
   const SP_BASE = 'https://YOUR-PROD.vercel.app';
   ```
   Publish, hard refresh, test.
