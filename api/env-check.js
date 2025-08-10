module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ hasDatabaseUrl: !!process.env.DATABASE_URL });
};
