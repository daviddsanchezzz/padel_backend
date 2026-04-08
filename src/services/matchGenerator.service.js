/**
 * Generate a round-robin schedule for a list of team IDs.
 * Each pair plays once (home/away alternated).
 * Returns an array of { homeTeam, awayTeam, round } objects.
 */
const generateRoundRobin = (teamIds) => {
  const teams = [...teamIds];
  // If odd number, add a "bye" slot
  if (teams.length % 2 !== 0) teams.push(null);

  const totalRounds = teams.length - 1;
  const half = teams.length / 2;
  const matches = [];

  for (let round = 0; round < totalRounds; round++) {
    for (let i = 0; i < half; i++) {
      const home = teams[i];
      const away = teams[teams.length - 1 - i];
      if (home && away) {
        matches.push({
          homeTeam: home,
          awayTeam: away,
          round: round + 1,
        });
      }
    }
    // Rotate teams (keep first fixed)
    teams.splice(1, 0, teams.pop());
  }

  return matches;
};

module.exports = { generateRoundRobin };
