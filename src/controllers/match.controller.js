const Match = require('../models/Match');
const MatchEvent = require('../models/MatchEvent');
const Team = require('../models/Team');
const Competition = require('../models/Competition');
const Division = require('../models/Division');
const { generateRoundRobin } = require('../services/matchGenerator.service');
const { generateBracket, advanceWinner } = require('../services/bracket.service');
const { determineWinner } = require('../services/score.service');

const populateMatch = (query) =>
  query
    .populate('teamA', 'name players playerNames')
    .populate('teamB', 'name players playerNames')
    .populate('winner', 'name')
    .populate({ path: 'division', select: 'name' })
    .populate({ path: 'competition', select: 'name type settings organizer', populate: { path: 'sport', select: 'scoringType slug' } });

const DEFAULT_EVENT_TYPES = ['goal', 'assist', 'yellow_card', 'red_card'];

const getResultConfig = (competition) => {
  const cfg = competition?.settings?.resultConfig || {};
  const mode = cfg.mode === 'events' ? 'events' : 'manual';
  const enabledEventTypes = Array.isArray(cfg.enabledEventTypes) && cfg.enabledEventTypes.length > 0
    ? cfg.enabledEventTypes.filter((t) => DEFAULT_EVENT_TYPES.includes(t))
    : DEFAULT_EVENT_TYPES;
  return { mode, enabledEventTypes };
};

const isEventTrackingEnabled = (competition) => {
  const scoringType = competition?.sport?.scoringType || 'sets';
  const { mode } = getResultConfig(competition);
  return mode === 'events' && scoringType === 'goals';
};

// ── League matches ───────────────────────────────────────────────────────────
const getDivisionMatches = async (req, res) => {
  const matches = await populateMatch(
    Match.find({ division: req.params.divisionId }).sort({ round: 1, bracketPosition: 1 })
  );
  res.json(matches);
};

const getMatchById = async (req, res) => {
  const match = await populateMatch(Match.findById(req.params.id));
  if (!match) return res.status(404).json({ message: 'Match not found' });

  const isOrganizer = match.competition?.organizer?.toString() === req.user._id.toString();
  if (!isOrganizer) {
    const userTeam = await getPlayerTeam(req.user._id, match.teamA?._id || match.teamA, match.teamB?._id || match.teamB);
    if (!userTeam) return res.status(403).json({ message: 'No eres jugador de este partido' });
  }

  res.json(match);
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

const assertCanEditMatch = async (user, match) => {
  const isOrganizer = match.competition.organizer?.toString() === user._id.toString();
  if (isOrganizer) return { allowed: true, isOrganizer: true, userTeam: null };
  const userTeam = await getPlayerTeam(user._id, match.teamA, match.teamB);
  if (!userTeam) return { allowed: false };
  return { allowed: true, isOrganizer: false, userTeam };
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

const normaliseEventsPayload = (events) => Array.isArray(events) ? events : [];

const ensurePlayerBelongsToTeam = (team, playerName, playerSlot) => {
  const names = Array.isArray(team.playerNames) ? team.playerNames : [];
  if (!playerName || !playerName.trim()) return { ok: false, message: 'El jugador es obligatorio' };
  const trimmed = playerName.trim();
  const matchedIndex = names.findIndex((n) => (n || '').trim() === trimmed);
  if (matchedIndex < 0) return { ok: false, message: `Jugador "${trimmed}" no pertenece al equipo ${team.name}` };
  if (playerSlot != null && Number(playerSlot) !== matchedIndex) {
    return { ok: false, message: `Slot de jugador invalido para ${trimmed}` };
  }
  return { ok: true, slot: matchedIndex, playerName: trimmed, playerId: team.players?.[matchedIndex] || null };
};

const recalculateMatchFromEvents = async (match) => {
  const goals = await MatchEvent.find({ match: match._id, type: 'goal' }).lean();
  const teamAId = match.teamA?.toString();
  const teamBId = match.teamB?.toString();
  const scoreA = goals.filter((e) => e.team?.toString() === teamAId).length;
  const scoreB = goals.filter((e) => e.team?.toString() === teamBId).length;
  await finaliseMatch(match, { goals: { a: scoreA, b: scoreB } }, 'goals');
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
  if (isEventTrackingEnabled(match.competition)) {
    return res.status(400).json({ message: 'Esta competicion usa registro por eventos. Usa el formulario de detalles del partido.' });
  }
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

const getMatchEvents = async (req, res) => {
  const match = await Match.findById(req.params.id)
    .populate({ path: 'competition', populate: { path: 'sport' } })
    .populate('teamA', 'name playerNames players')
    .populate('teamB', 'name playerNames players');
  if (!match) return res.status(404).json({ message: 'Match not found' });

  const access = await assertCanEditMatch(req.user, match);
  if (!access.allowed) return res.status(403).json({ message: 'No eres jugador de este partido' });

  const events = await MatchEvent.find({ match: match._id })
    .sort({ order: 1, minute: 1, createdAt: 1 })
    .lean();
  res.json(events);
};

const recordMatchEvents = async (req, res) => {
  const match = await Match.findById(req.params.id)
    .populate({ path: 'competition', populate: { path: 'sport' } })
    .populate('teamA', 'name playerNames players')
    .populate('teamB', 'name playerNames players');
  if (!match) return res.status(404).json({ message: 'Match not found' });

  if (!isEventTrackingEnabled(match.competition)) {
    return res.status(400).json({ message: 'Esta competicion no tiene activado el registro por eventos' });
  }

  const access = await assertCanEditMatch(req.user, match);
  if (!access.allowed || !access.isOrganizer) return res.status(403).json({ message: 'Solo el organizador puede editar eventos' });

  const { enabledEventTypes } = getResultConfig(match.competition);
  const payloadEvents = normaliseEventsPayload(req.body.events);
  const normalised = [];

  for (let i = 0; i < payloadEvents.length; i++) {
    const e = payloadEvents[i];
    if (!enabledEventTypes.includes(e.type)) {
      return res.status(400).json({ message: `Tipo de evento no permitido: ${e.type}` });
    }

    const minute = Number(e.minute);
    if (!Number.isInteger(minute) || minute < 0 || minute > 130) {
      return res.status(400).json({ message: 'El minuto del evento es invalido (0-130)' });
    }

    const teamId = e.team?.toString();
    const isTeamA = teamId === match.teamA?._id?.toString();
    const isTeamB = teamId === match.teamB?._id?.toString();
    if (!isTeamA && !isTeamB) {
      return res.status(400).json({ message: 'El equipo del evento no pertenece al partido' });
    }

    const team = isTeamA ? match.teamA : match.teamB;
    const playerValidation = ensurePlayerBelongsToTeam(team, e.playerName, e.playerSlot);
    if (!playerValidation.ok) return res.status(400).json({ message: playerValidation.message });

    normalised.push({
      competition: match.competition._id,
      match: match._id,
      type: e.type,
      minute,
      team: team._id,
      playerName: playerValidation.playerName,
      playerSlot: playerValidation.slot,
      player: playerValidation.playerId,
      order: i,
    });
  }

  await MatchEvent.deleteMany({ match: match._id });
  if (normalised.length > 0) {
    await MatchEvent.insertMany(normalised);
  }

  await recalculateMatchFromEvents(match);
  const events = await MatchEvent.find({ match: match._id })
    .sort({ order: 1, minute: 1, createdAt: 1 });

  await match.populate('teamA', 'name players playerNames');
  await match.populate('teamB', 'name players playerNames');
  await match.populate('winner', 'name');
  res.json({ match, events });
};

const getCompetitionPlayerStats = async (req, res) => {
  const competition = await Competition.findById(req.params.competitionId);
  if (!competition) return res.status(404).json({ message: 'Competition not found' });

  const stats = await MatchEvent.aggregate([
    { $match: { competition: competition._id } },
    {
      $group: {
        _id: { playerName: '$playerName', team: '$team' },
        goals: { $sum: { $cond: [{ $eq: ['$type', 'goal'] }, 1, 0] } },
        assists: { $sum: { $cond: [{ $eq: ['$type', 'assist'] }, 1, 0] } },
        yellowCards: { $sum: { $cond: [{ $eq: ['$type', 'yellow_card'] }, 1, 0] } },
        redCards: { $sum: { $cond: [{ $eq: ['$type', 'red_card'] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        playerName: '$_id.playerName',
        team: '$_id.team',
        goals: 1,
        assists: 1,
        yellowCards: 1,
        redCards: 1,
      },
    },
    { $sort: { goals: -1, assists: -1, yellowCards: -1, redCards: -1, playerName: 1 } },
  ]);

  res.json(stats);
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
  getMatchById,
  getDivisionMatches,
  generateLeagueMatches,
  generateTournamentBracket,
  getTournamentBracket,
  generateDivisionBracket,
  getDivisionBracket,
  recordResult,
  getMatchEvents,
  recordMatchEvents,
  getCompetitionPlayerStats,
  confirmResult,
  disputeResult,
  getPlayerMatches,
};
