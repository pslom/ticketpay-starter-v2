// api/notifications/send-worker.js
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).end(JSON.stringify({ ok: true, note: 'Send queued notifications here' }));
};
