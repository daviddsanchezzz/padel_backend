const { generateRoundRobin } = require('./matchGenerator.service');
const { determineWinner } = require('./score.service');

// Fisher-Yates shuffle
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * Distribute teams evenly across groups.
 * @param {Array} teamIds
 * @param {number} teamsPerGroup  — target max per group
 * @returns {Array<{ name: string, teamIds: Array }>}
 */
const createGroups = (teamIds, teamsPerGroup) => {
  const shuffled = shuffle(teamIds);
  const numGroups = Math.max(2, Math.ceil(shuffled.length / teamsPerGroup));
  const groups = [];

  for (let i = 0; i < numGroups; i++) {
    const groupsLeft = numGroups - i;
    const teamsLeft = shuffled.length - groups.reduce((sum, g) => sum + g.teamIds.length, 0);
    const size = Math.ceil(teamsLeft / groupsLeft);
    const name = String.fromCharCode(65 + i); // A, B, C, D...
    groups.push({ name, teamIds: shuffled.splice(0, size) });
  }

  return groups;
};

/**
 * Generate all match docs for a group stage.
 * @param {Array<{ name, teamIds }>} groups
 * @param {ObjectId} competitionId
 * @param {ObjectId} divisionId
 * @returns {Array} match documents
 */
const generateGroupMatches = (groups, competitionId, divisionId) => {
  const docs = [];
  for (const group of groups) {
    const schedule = generateRoundRobin(group.teamIds);
    for (const m of schedule) {
      docs.push({
        competition: competitionId,
        division: divisionId,
        teamA: m.homeTeam,
        teamB: m.awayTeam,
        round: m.round,
        roundName: `Jornada ${m.round}`,
        phase: 'group',
        group: group.name,
        status: 'pending',
      });
    }
  }
  return docs;
};

/**
 * Compute standings for a set of teams from their played matches.
 * @param {Array} teams
 * @param {Array} matches — only 'played' matches are counted
 * @param {string} scoringType
 * @returns {Array} sorted standings
 */
const computeStandings = (teams, matches, scoringType) => {
  const table = {};

  for (const team of teams) {
    const id = team._id.toString();
    table[id] = {
      teamId: team._id,
      teamName: team.name,
      played: 0, won: 0, drawn: 0, lost: 0,
      points: 0, goalsFor: 0, goalsAgainst: 0,
    };
  }

  for (const match of matches) {
    if (match.status !== 'played' || !match.result) continue;

    const aId = (match.teamA?._id || match.teamA)?.toString();
    const bId = (match.teamB?._id || match.teamB)?.toString();
    if (!aId || !bId || !table[aId] || !table[bId]) continue;

    const side = determineWinner(match.result, scoringType);
    table[aId].played++;
    table[bId].played++;

    if (side === 'A') {
      table[aId].won++;    table[aId].points += 3;
      table[bId].lost++;
    } else if (side === 'B') {
      table[bId].won++;    table[bId].points += 3;
      table[aId].lost++;
    } else {
      table[aId].drawn++; table[aId].points += 1;
      table[bId].drawn++; table[bId].points += 1;
    }

    if (scoringType === 'goals' && match.result?.goals) {
      const { a, b } = match.result.goals;
      table[aId].goalsFor += Number(a) || 0;
      table[aId].goalsAgainst += Number(b) || 0;
      table[bId].goalsFor += Number(b) || 0;
      table[bId].goalsAgainst += Number(a) || 0;
    }
  }

  return Object.values(table).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdB = b.goalsFor - b.goalsAgainst;
    const gdA = a.goalsFor - a.goalsAgainst;
    if (gdB !== gdA) return gdB - gdA;
    return b.goalsFor - a.goalsFor;
  });
};

module.exports = { createGroups, generateGroupMatches, computeStandings };
