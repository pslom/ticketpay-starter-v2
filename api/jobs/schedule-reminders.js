// api/jobs/schedule-reminders.js
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).end(JSON.stringify({ ok: true, note: 'Schedule 72h and due reminders here' }));
};
