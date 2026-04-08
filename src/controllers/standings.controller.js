const { calculateStandings } = require('../services/standings.service');

const getStandings = async (req, res) => {
  const standings = await calculateStandings(req.params.divisionId);
  res.json(standings);
};

module.exports = { getStandings };
