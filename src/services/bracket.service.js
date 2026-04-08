/**
 * Single-elimination bracket generator.
 *
 * Given N teams, generates all match slots for all rounds.
 * Round 1 teams are filled in; subsequent rounds start with null teams
 * and get filled in as results are recorded.
 *
 * bracketPosition is a 0-indexed slot within each round.
 * Parent-child linking: match at round R, pos P
 *   feeds into round R+1, pos floor(P/2).
 */

const ROUND_NAMES = {
  1: 'Final',
  2: 'Semifinal',
  4: 'Cuartos de final',
  8: 'Octavos de final',
  16: 'Dieciseisavos',
};

const getRoundName = (matchesInRound) => ROUND_NAMES[matchesInRound] || `Ronda (${matchesInRound})`;

/**
 * Returns next power of 2 >= n.
 */
const nextPow2 = (n) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

/**
 * Classic bracket seeding order so that
 * seed 1 meets seed 2^k in the final (if all upsets avoided).
 * Returns an array of seed indices (1-based, 0 = bye).
 */
const seedOrder = (size) => {
  let slots = [1, 2];
  while (slots.length < size) {
    const next = [];
    const total = slots.length * 2 + 1;
    slots.forEach((s) => {
      next.push(s);
      next.push(total - s);
    });
    slots = next;
  }
  return slots;
};

/**
 * Generate all bracket match slots.
 * @param {ObjectId[]} teamIds      — ordered array of team IDs (sorted by seed or insertion order)
 * @param {ObjectId}   competitionId
 * @param {ObjectId}   [divisionId] — optional, for tournament categories
 * @returns Array of match objects ready for Match.insertMany()
 */
const generateBracket = (teamIds, competitionId, divisionId = null) => {
  const n = teamIds.length;
  const bracketSize = nextPow2(n);
  const totalRounds = Math.log2(bracketSize);

  // Build seed slots — pad with null for byes
  const order = seedOrder(bracketSize);
  const slots = order.map((seed) => (seed <= n ? teamIds[seed - 1] : null));

  const matches = [];

  // Round 1: pair up slots
  const round1MatchCount = bracketSize / 2;
  for (let i = 0; i < round1MatchCount; i++) {
    const teamA = slots[i * 2]     || null;
    const teamB = slots[i * 2 + 1] || null;
    matches.push({
      competition: competitionId,
      division: divisionId,
      teamA,
      teamB,
      round: 1,
      roundName: getRoundName(round1MatchCount),
      bracketPosition: i,
      status: teamA && teamB ? 'pending' : 'bye',
    });
  }

  // Subsequent rounds — all TBD
  for (let r = 2; r <= totalRounds; r++) {
    const matchCount = bracketSize / Math.pow(2, r);
    for (let i = 0; i < matchCount; i++) {
      matches.push({
        competition: competitionId,
        division: divisionId,
        teamA: null,
        teamB: null,
        round: r,
        roundName: getRoundName(matchCount),
        bracketPosition: i,
        status: 'pending',
      });
    }
  }

  return matches;
};

/**
 * After a match result is recorded, advance the winner to the next round slot.
 * @param {Match}  match  — the played match (populated winner)
 * @param {Model}  Match  — the Mongoose model
 */
const advanceWinner = async (match, Match) => {
  if (!match.winner || match.round === null || match.bracketPosition === null) return;

  const nextRound    = match.round + 1;
  const nextPosition = Math.floor(match.bracketPosition / 2);
  const isTeamA      = match.bracketPosition % 2 === 0; // even pos → teamA slot

  const nextMatch = await Match.findOne({
    competition: match.competition,
    division: match.division ?? null,   // scope to same category/division
    round: nextRound,
    bracketPosition: nextPosition,
  });

  if (!nextMatch) return; // final already played or doesn't exist

  if (isTeamA) {
    nextMatch.teamA = match.winner;
  } else {
    nextMatch.teamB = match.winner;
  }

  // If both teams are now filled, activate the match
  if (nextMatch.teamA && nextMatch.teamB) {
    nextMatch.status = 'pending';
  }

  await nextMatch.save();
};

module.exports = { generateBracket, advanceWinner, getRoundName };
