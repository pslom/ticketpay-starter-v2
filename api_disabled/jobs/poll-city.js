// api/jobs/poll-city.js
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).end(JSON.stringify({ ok: true, note: 'Implement DC adapter here' }));
};
