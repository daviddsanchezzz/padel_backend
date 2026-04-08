const Match = require('../models/Match');
const Team = require('../models/Team');
const Competition = require('../models/Competition');
const Sport = require('../models/Sport');
const { extractSetsWon } = require('./score.service');

const calculateStandings = async (divisionId) => {
  const teams = await Team.find({ division: divisionId }).lean();
  const matches = await Match.find({ division: divisionId, status: 'played' }).lean();

  // Load competition settings to get points config
  const firstTeam = teams[0];
  let settings = { pointsPerWin: 3, pointsPerLoss: 0, pointsPerDraw: 1, tieBreakers: ['points', 'setDifference', 'setsFor'] };
  let scoringType = 'sets';

  if (firstTeam) {
    const competition = await Competition.findById(firstTeam.competition).populate('sport').lean();
    if (competition) {
      settings = { ...settings, ...competition.settings };
      scoringType = competition.sport?.scoringType || 'sets';
    }
  }

  const stats = {};
  teams.forEach((team) => {
    stats[team._id.toString()] = {
      team,
      played: 0,
      won: 0,
      lost: 0,
      drawn: 0,
      setsWon: 0,
      setsLost: 0,
      points: 0,
    };
  });

  matches.forEach((match) => {
    const idA = match.teamA?.toString();
    const idB = match.teamB?.toString();
    if (!idA || !idB || !stats[idA] || !stats[idB]) return;

    const winnerId = match.winner?.toString();
    const { setsA, setsB } = extractSetsWon(match.result, scoringType);

    stats[idA].played++;
    stats[idB].played++;
    stats[idA].setsWon  += setsA;
    stats[idA].setsLost += setsB;
    stats[idB].setsWon  += setsB;
    stats[idB].setsLost += setsA;

    if (winnerId === idA) {
      stats[idA].won++;
      stats[idA].points += settings.pointsPerWin;
      stats[idB].lost++;
      stats[idB].points += settings.pointsPerLoss;
    } else if (winnerId === idB) {
      stats[idB].won++;
      stats[idB].points += settings.pointsPerWin;
      stats[idA].lost++;
      stats[idA].points += settings.pointsPerLoss;
    } else {
      stats[idA].drawn++;
      stats[idA].points += settings.pointsPerDraw;
      stats[idB].drawn++;
      stats[idB].points += settings.pointsPerDraw;
    }
  });

  const sorted = Object.values(stats).sort((a, b) => {
    const tieBreakers = settings.tieBreakers || ['points', 'setDifference', 'setsFor'];
    for (const criterion of tieBreakers) {
      if (criterion === 'points')        { if (b.points !== a.points) return b.points - a.points; }
      if (criterion === 'setDifference') { const da = a.setsWon - a.setsLost, db = b.setsWon - b.setsLost; if (db !== da) return db - da; }
      if (criterion === 'setsFor')       { if (b.setsWon !== a.setsWon) return b.setsWon - a.setsWon; }
    }
    return 0;
  });

  return sorted.map((s, i) => ({
    position: i + 1,
    team: s.team,
    played: s.played,
    won: s.won,
    drawn: s.drawn,
    lost: s.lost,
    setsWon: s.setsWon,
    setsLost: s.setsLost,
    setDiff: s.setsWon - s.setsLost,
    points: s.points,
  }));
};

module.exports = { calculateStandings };
