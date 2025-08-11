# TicketPay Clean Skeleton
This repo is a clean, working baseline for Vercel + Postgres + Stripe + SendGrid + Twilio.

## Structure
- `/api/*` — serverless functions (endpoints)
- `/success.html`, `/cancel.html` — static pages used by Stripe redirect
- `/index.html` — avoids 404 at root

## Environment (Vercel → Settings → Env Vars)
- DATABASE_URL
- SITE_URL (e.g. https://your-app.vercel.app)
- ALLOWED_ORIGIN (e.g. https://ticketpay.us.com)
- STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
- SENDGRID_API_KEY, FROM_EMAIL
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

## Build settings (Vercel)
Framework: Other • Build Command: (empty) • Output Dir: (empty)
