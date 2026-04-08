const Match = require('../models/Match');
const Team = require('../models/Team');
const Competition = require('../models/Competition');
const Division = require('../models/Division');
const Sport = require('../models/Sport');
const { generateRoundRobin } = require('../services/matchGenerator.service');
const { generateBracket, advanceWinner } = require('../services/bracket.service');
const { determineWinner } = require('../services/score.service');

const populateMatch = (query) =>
  query
    .populate('teamA', 'name players')
    .populate('teamB', 'name players')
    .populate('winner', 'name')
    .populate({ path: 'division', select: 'name' })
    .populate({ path: 'competition', select: 'name type settings organizer', populate: { path: 'sport', select: 'scoringType' } });

// ── League matches ───────────────────────────────────────────────────────────
const getDivisionMatches = async (req, res) => {
  const matches = await populateMatch(
    Match.find({ division: req.params.divisionId }).sort({ round: 1, bracketPosition: 1 })
  );
  res.json(matches);
};

const generateLeagueMatches = async (req, res) => {
  const { divisionId } = req.params;

  const division = await Division.findById(divisionId).populate('competition');
  if (!division) return res.status(404).json({ message: 'Division not found' });
  if (division.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const teams = await Team.find({ division: divisionId });
  if (teams.length < 2) return res.status(400).json({ message: 'At least 2 teams needed' });

  await Match.deleteMany({ division: divisionId, status: 'pending' });

  const schedule = generateRoundRobin(teams.map((t) => t._id));
  const docs = schedule.map((m) => ({
    competition: division.competition._id,
    division: divisionId,
    teamA: m.homeTeam,
    teamB: m.awayTeam,
    round: m.round,
    roundName: `Jornada ${m.round}`,
    status: 'pending',
  }));

  const matches = await Match.insertMany(docs);
  res.status(201).json({ count: matches.length });
};

// ── Tournament bracket ────────────────────────────────────────────────────────
const generateTournamentBracket = async (req, res) => {
  const { competitionId } = req.params;

  const competition = await Competition.findOne({ _id: competitionId, organizer: req.user._id })
    .populate('sport');
  if (!competition) return res.status(404).json({ message: 'Competition not found' });

  const teams = await Team.find({ competition: competitionId, division: null });
  if (teams.length < 2) return res.status(400).json({ message: 'At least 2 teams needed' });

  // Remove all existing bracket matches
  await Match.deleteMany({ competition: competitionId, division: null });

  // Sort by seed if available
  const sorted = [...teams].sort((a, b) => {
    if (a.seed && b.seed) return a.seed - b.seed;
    if (a.seed) return -1;
    if (b.seed) return 1;
    return 0;
  });

  const docs = generateBracket(sorted.map((t) => t._id), competitionId);
  await Match.insertMany(docs);

  res.status(201).json({ message: 'Bracket generated', teams: teams.length });
};

const getTournamentBracket = async (req, res) => {
  const matches = await populateMatch(
    Match.find({ competition: req.params.competitionId, division: null })
      .sort({ round: 1, bracketPosition: 1 })
  );

  // Group by round
  const byRound = {};
  matches.forEach((m) => {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round].push(m);
  });

  res.json(byRound);
};

// ── Division bracket (tournament categories) ─────────────────────────────────
const generateDivisionBracket = async (req, res) => {
  const { divisionId } = req.params;

  const division = await Division.findById(divisionId).populate({ path: 'competition', populate: { path: 'sport' } });
  if (!division) return res.status(404).json({ message: 'Division not found' });
  if (division.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const teams = await Team.find({ division: divisionId });
  if (teams.length < 2) return res.status(400).json({ message: 'At least 2 teams needed' });

  await Match.deleteMany({ division: divisionId });

  const sorted = [...teams].sort((a, b) => {
    if (a.seed && b.seed) return a.seed - b.seed;
    if (a.seed) return -1;
    if (b.seed) return 1;
    return 0;
  });

  const docs = generateBracket(sorted.map((t) => t._id), division.competition._id, divisionId);
  await Match.insertMany(docs);

  res.status(201).json({ message: 'Bracket generated', teams: teams.length });
};

const getDivisionBracket = async (req, res) => {
  const matches = await populateMatch(
    Match.find({ division: req.params.divisionId }).sort({ round: 1, bracketPosition: 1 })
  );

  const byRound = {};
  matches.forEach((m) => {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round].push(m);
  });

  res.json(byRound);
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const getPlayerTeam = async (userId, teamAId, teamBId) => {
  const teams = await Team.find({ _id: { $in: [teamAId, teamBId] } });
  return teams.find(t => t.players.some(p => p?.toString() === userId.toString())) || null;
};

const finaliseMatch = async (match, result, scoringType) => {
  const side = determineWinner(result, scoringType);
  match.result = result;
  match.status = 'played';
  match.winner = side === 'A' ? match.teamA : side === 'B' ? match.teamB : null;
  match.pendingResult = null;
  match.proposedBy = null;
  await match.save();
  if (match.bracketPosition != null) await advanceWinner(match, Match);
};

// ── Record result (shared for league + tournament) ───────────────────────────
const recordResult = async (req, res) => {
  const { result } = req.body;
  if (!result) return res.status(400).json({ message: 'Result is required' });

  const match = await Match.findById(req.params.id)
    .populate({ path: 'competition', populate: { path: 'sport' } });
  if (!match) return res.status(404).json({ message: 'Match not found' });
  if (match.status === 'played') return res.status(400).json({ message: 'Match already played' });

  const scoringType = match.competition.sport?.scoringType || 'sets';
  const isOrganizer = match.competition.organizer?.toString() === req.user._id.toString();

  if (isOrganizer) {
    await finaliseMatch(match, result, scoringType);
  } else {
    const userTeam = await getPlayerTeam(req.user._id, match.teamA, match.teamB);
    if (!userTeam) return res.status(403).json({ message: 'No eres jugador de este partido' });

    // If other team already proposed, don't allow overwriting — they must confirm/dispute
    if (match.status === 'awaiting_confirmation' && match.proposedBy?.toString() !== userTeam._id.toString()) {
      return res.status(400).json({ message: 'El rival ya ha propuesto un resultado. Confírmalo o recházalo.' });
    }

    match.pendingResult = result;
    match.status = 'awaiting_confirmation';
    match.proposedBy = userTeam._id;
    await match.save();
  }

  await match.populate('teamA', 'name players');
  await match.populate('teamB', 'name players');
  await match.populate('winner', 'name');
  res.json(match);
};

// ── Confirm pending result ────────────────────────────────────────────────────
const confirmResult = async (req, res) => {
  const match = await Match.findById(req.params.id)
    .populate({ path: 'competition', populate: { path: 'sport' } });
  if (!match) return res.status(404).json({ message: 'Match not found' });
  if (match.status !== 'awaiting_confirmation') {
    return res.status(400).json({ message: 'No hay resultado pendiente de confirmación' });
  }

  const isOrganizer = match.competition.organizer?.toString() === req.user._id.toString();
  if (!isOrganizer) {
    const userTeam = await getPlayerTeam(req.user._id, match.teamA, match.teamB);
    if (!userTeam) return res.status(403).json({ message: 'Forbidden' });
    if (match.proposedBy?.toString() === userTeam._id.toString()) {
      return res.status(400).json({ message: 'No puedes confirmar tu propio resultado' });
    }
  }

  const scoringType = match.competition.sport?.scoringType || 'sets';
  await finaliseMatch(match, match.pendingResult, scoringType);

  await match.populate('teamA', 'name players');
  await match.populate('teamB', 'name players');
  await match.populate('winner', 'name');
  res.json(match);
};

// ── Dispute (reject) pending result ──────────────────────────────────────────
const disputeResult = async (req, res) => {
  const match = await Match.findById(req.params.id)
    .populate({ path: 'competition', populate: { path: 'sport' } });
  if (!match) return res.status(404).json({ message: 'Match not found' });
  if (match.status !== 'awaiting_confirmation') {
    return res.status(400).json({ message: 'No hay resultado pendiente' });
  }

  const isOrganizer = match.competition.organizer?.toString() === req.user._id.toString();
  if (!isOrganizer) {
    const userTeam = await getPlayerTeam(req.user._id, match.teamA, match.teamB);
    if (!userTeam) return res.status(403).json({ message: 'Forbidden' });
    if (match.proposedBy?.toString() === userTeam._id.toString()) {
      return res.status(400).json({ message: 'No puedes rechazar tu propio resultado' });
    }
  }

  match.status = 'pending';
  match.pendingResult = null;
  match.proposedBy = null;
  await match.save();

  await match.populate('teamA', 'name players');
  await match.populate('teamB', 'name players');
  await match.populate('winner', 'name');
  res.json(match);
};

// ── Player matches ────────────────────────────────────────────────────────────
const getPlayerMatches = async (req, res) => {
  const teams = await Team.find({ players: req.user._id });
  const teamIds = teams.map((t) => t._id);

  const matches = await populateMatch(
    Match.find({ $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }] })
      .sort({ round: 1, createdAt: -1 })
  );
  res.json(matches);
};

module.exports = {
  getDivisionMatches,
  generateLeagueMatches,
  generateTournamentBracket,
  getTournamentBracket,
  generateDivisionBracket,
  getDivisionBracket,
  recordResult,
  confirmResult,
  disputeResult,
  getPlayerMatches,
};
