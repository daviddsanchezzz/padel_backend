/**
 * Determines the winner of a match from a flexible result object.
 * Returns 'A', 'B', or 'draw'.
 *
 * Supported scoringTypes:
 *   'sets'   → result: { sets: [{a, b}, ...] }
 *   'goals'  → result: { goals: { a, b } }
 *   'points' → result: { points: { a, b } }
 */
const determineWinner = (result, scoringType) => {
  if (!result) return null;

  if (scoringType === 'sets') {
    const sets = result.sets || [];
    let winsA = 0, winsB = 0;
    sets.forEach((s) => {
      if (s.a > s.b) winsA++;
      else if (s.b > s.a) winsB++;
    });
    if (winsA > winsB) return 'A';
    if (winsB > winsA) return 'B';
    return 'draw';
  }

  if (scoringType === 'goals') {
    const { a, b } = result.goals || {};
    if (a > b) return 'A';
    if (b > a) return 'B';
    return 'draw';
  }

  if (scoringType === 'points') {
    const { a, b } = result.points || {};
    if (a > b) return 'A';
    if (b > a) return 'B';
    return 'draw';
  }

  return null;
};

/**
 * Extracts set counts (a won, b won) for standings calculation.
 * Only meaningful for 'sets' scoring type.
 */
const extractSetsWon = (result, scoringType) => {
  if (scoringType !== 'sets' || !result?.sets) return { setsA: 0, setsB: 0 };
  let setsA = 0, setsB = 0;
  (result.sets || []).forEach((s) => {
    if (s.a > s.b) setsA++;
    else if (s.b > s.a) setsB++;
  });
  return { setsA, setsB };
};

module.exports = { determineWinner, extractSetsWon };
