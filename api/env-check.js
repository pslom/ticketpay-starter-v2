// api/env-check.js
module.exports = (req, res) => {
  const keys = ['DATABASE_URL','SITE_URL','ALLOWED_ORIGIN','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','SENDGRID_API_KEY','FROM_EMAIL','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER'];
  const present = Object.fromEntries(keys.map(k => [k, !!process.env[k]]));
  res.setHeader('Content-Type', 'application/json');
  res.status(200).end(JSON.stringify({ ok: true, present }));
};
