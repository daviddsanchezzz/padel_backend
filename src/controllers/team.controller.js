const Team = require('../models/Team');
const Division = require('../models/Division');
const Competition = require('../models/Competition');

/**
 * Converts a raw array of name strings into player slot objects.
 * e.g. ['Carlos', 'María'] → [{ name: 'Carlos', userId: null }, { name: 'María', userId: null }]
 */
const buildPlayerSlots = (playerNames) => {
  if (!Array.isArray(playerNames)) return [];
  return playerNames
    .map((n) => {
      if (typeof n === 'string') return { name: n.trim(), dorsal: null, userId: null };
      if (typeof n === 'object' && n !== null) {
        const name = typeof n.name === 'string' ? n.name.trim() : '';
        const dorsal = n.dorsal != null && n.dorsal !== '' ? Number(n.dorsal) : null;
        return { name, dorsal, userId: null };
      }
      return null;
    })
    .filter((s) => s && s.name);
};

const resolveTeamSize = ({ competition, division }) => {
  const fromDivision = division?.teamSize;
  const fromCompetition = competition?.settings?.teamSize;
  const fromSport = competition?.sport?.teamSize;
  return Number(fromDivision ?? fromCompetition ?? fromSport ?? 1);
};

// ── League teams (scoped to a division) ──────────────────────────────────────
const getDivisionTeams = async (req, res) => {
  const division = await Division.findById(req.params.divisionId);
  if (!division) return res.status(404).json({ message: 'Division not found' });

  const teams = await Team.find({ division: req.params.divisionId, seasonId: division.seasonId });
  res.json(teams);
};

const createDivisionTeam = async (req, res) => {
  const { divisionId } = req.params;
  const { name, playerNames } = req.body;

  const division = await Division.findById(divisionId).populate({ path: 'competition', populate: { path: 'sport' } });
  if (!division) return res.status(404).json({ message: 'Division not found' });
  if (division.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const teamSize = resolveTeamSize({ competition: division.competition, division });
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const slots = buildPlayerSlots(playerNames);
  const maxTeamsPerDivision = Number(division.competition?.settings?.maxTeamsPerDivision || 0);

  if (maxTeamsPerDivision > 0) {
    const currentTeams = await Team.countDocuments({ division: divisionId, seasonId: division.seasonId });
    if (currentTeams >= maxTeamsPerDivision) {
      return res.status(409).json({ message: `Maximo ${maxTeamsPerDivision} equipos por division/categoria alcanzado` });
    }
  }

  let teamName = trimmedName;
  let storedPlayers = [];

  if (teamSize <= 2) {
    if (slots.length !== teamSize) {
      return res.status(400).json({
        message: `Debe proporcionar exactamente ${teamSize} ${teamSize === 1 ? 'nombre de jugador' : 'nombres de jugadores'}`,
      });
    }
    storedPlayers = slots;
    teamName = slots.map((p) => p.name).join(' / ');
  } else {
    if (!trimmedName) return res.status(400).json({ message: 'Nombre del equipo es requerido' });
    storedPlayers = slots; // can be empty or partial for large teams
  }

  const team = await Team.create({
    name: teamName,
    players: storedPlayers,
    competition: division.competition._id,
    division: divisionId,
    seasonName: division.seasonName,
  });

  res.status(201).json(team);
};

// ── Tournament teams (scoped to competition, no division) ────────────────────
const getCompetitionTeams = async (req, res) => {
  const competition = await Competition.findById(req.params.competitionId);
  if (!competition) return res.status(404).json({ message: 'Competition not found' });

  const activeSeason = competition.seasons.find((s) => s.isActive);
  if (!activeSeason) return res.status(404).json({ message: 'No active season' });

  const teams = await Team.find({
    competition: req.params.competitionId,
    division: null,
    seasonName: activeSeason.name,
  });
  res.json(teams);
};

// Organizer-only detailed list for all teams in a competition (active season)
const getCompetitionTeamsDetailed = async (req, res) => {
  const competition = await Competition.findOne({
    _id: req.params.competitionId,
    organizer: req.user._id,
  });
  if (!competition) return res.status(404).json({ message: 'Competition not found' });

  const activeSeason = competition.seasons.find((s) => s.isActive);
  if (!activeSeason) return res.status(404).json({ message: 'No active season' });

  const teams = await Team.find({
    competition: competition._id,
    seasonName: activeSeason.name,
  })
    .populate('division', 'name order seasonName')
    .sort({ createdAt: 1 });

  const detailed = teams.map((team) => ({
    _id: team._id,
    name: team.name,
    seasonName: team.seasonName,
    division: team.division
      ? {
          _id: team.division._id,
          name: team.division.name,
          order: team.division.order,
        }
      : null,
    players: Array.isArray(team.players)
      ? team.players.map((p) => ({
          name: p.name,
          dorsal: p.dorsal ?? null,
          userId: p.userId ?? null,
        }))
      : [],
    playerCount: Array.isArray(team.players) ? team.players.length : 0,
    group: team.group || null,
    contactEmail: team.contactEmail || null,
    paymentStatus: team.paymentStatus || 'free',
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  }));

  detailed.sort((a, b) => {
    const orderA = a.division?.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.division?.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  res.json({
    competition: {
      _id: competition._id,
      name: competition.name,
      type: competition.type,
    },
    activeSeason: activeSeason.name,
    totalTeams: detailed.length,
    teams: detailed,
  });
};

const createCompetitionTeam = async (req, res) => {
  const { competitionId } = req.params;
  const { name, playerNames, seed } = req.body;

  const competition = await Competition.findOne({ _id: competitionId, organizer: req.user._id }).populate('sport');
  if (!competition) return res.status(404).json({ message: 'Competition not found' });

  const activeSeason = competition.seasons.find((s) => s.isActive);
  if (!activeSeason) return res.status(400).json({ message: 'No active season' });

  const teamSize = resolveTeamSize({ competition, division: null });
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const slots = buildPlayerSlots(playerNames);

  let teamName = trimmedName;
  let storedPlayers = [];

  if (teamSize <= 2) {
    if (slots.length !== teamSize) {
      return res.status(400).json({
        message: `Debe proporcionar exactamente ${teamSize} ${teamSize === 1 ? 'nombre de jugador' : 'nombres de jugadores'}`,
      });
    }
    storedPlayers = slots;
    teamName = slots.map((p) => p.name).join(' / ');
  } else {
    if (!trimmedName) return res.status(400).json({ message: 'Nombre del equipo es requerido' });
    storedPlayers = slots;
  }

  const team = await Team.create({
    name: teamName,
    players: storedPlayers,
    competition: competitionId,
    division: null,
    seasonName: activeSeason.name,
    seed: seed || null,
  });

  res.status(201).json(team);
};

// ── Assign a registered user to a player slot ────────────────────────────────
const joinTeam = async (req, res) => {
  const { id } = req.params;
  const { position } = req.body;

  const team = await Team.findById(id)
    .populate({ path: 'competition', populate: { path: 'sport' } })
    .populate('division');

  if (!team) return res.status(404).json({ message: 'Team not found' });

  const teamSize = resolveTeamSize({ competition: team.competition, division: team.division });

  if (!Number.isInteger(position) || position < 0 || position >= teamSize) {
    return res.status(400).json({ message: `Posición inválida. Debe ser entre 0 y ${teamSize - 1}` });
  }

  const userId = req.user.id;

  // User already claimed a slot in this team
  if (team.players.some((p) => p.userId === userId)) {
    return res.status(400).json({ message: 'Ya estás en este equipo' });
  }

  // User already in another team in the same scope
  const scopeQuery = team.division
    ? { division: team.division._id, seasonName: team.seasonName }
    : { competition: team.competition._id, division: null, seasonName: team.seasonName };

  const otherTeams = await Team.find({ ...scopeQuery, _id: { $ne: id } });
  if (otherTeams.some((t) => t.players.some((p) => p.userId === userId))) {
    return res.status(400).json({ message: 'Ya estás en otro equipo en esta división' });
  }

  // The slot must exist (have a name) and be unclaimed
  const slot = team.players[position];
  if (!slot) {
    return res.status(400).json({ message: `La posición ${position} no existe en este equipo` });
  }
  if (slot.userId) {
    return res.status(400).json({ message: `La posición ${position} ya está ocupada` });
  }

  team.players[position].userId = userId;
  await team.save();

  res.json(team);
};

// ── Update team name / player names ──────────────────────────────────────────
const updateTeam = async (req, res) => {
  const team = await Team.findById(req.params.id)
    .populate({ path: 'competition', populate: { path: 'sport' } })
    .populate('division');

  if (!team) return res.status(404).json({ message: 'Team not found' });
  if (team.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const teamSize = resolveTeamSize({ competition: team.competition, division: team.division });
  const hasName = typeof req.body.name === 'string';
  const hasPlayerNames = Array.isArray(req.body.playerNames);

  if (teamSize <= 2) {
    if (!hasPlayerNames) {
      return res.status(400).json({ message: 'Debe proporcionar los nombres de los jugadores' });
    }

    const slots = buildPlayerSlots(req.body.playerNames);
    if (slots.length !== teamSize) {
      return res.status(400).json({
        message: `Debe proporcionar exactamente ${teamSize} ${teamSize === 1 ? 'nombre de jugador' : 'nombres de jugadores'}`,
      });
    }

    // Preserve existing userIds when updating names
    team.players = slots.map((slot, i) => ({
      name: slot.name,
      dorsal: slot.dorsal ?? null,
      userId: team.players[i]?.userId ?? null,
    }));
    team.name = slots.map((p) => p.name).join(' / ');
  } else {
    if (!hasName && !hasPlayerNames) {
      return res.status(400).json({ message: 'Debe enviar nombre de equipo o jugadores' });
    }

    if (hasName) {
      const trimmedName = req.body.name.trim();
      if (!trimmedName) return res.status(400).json({ message: 'El nombre no puede estar vacío' });
      team.name = trimmedName;
    }

    if (hasPlayerNames) {
      const slots = buildPlayerSlots(req.body.playerNames);
      if (slots.length > teamSize) {
        return res.status(400).json({ message: `No puede haber más de ${teamSize} jugadores` });
      }
      // Preserve userIds for slots that remain
      team.players = slots.map((slot, i) => ({
        name: slot.name,
        dorsal: slot.dorsal ?? null,
        userId: team.players[i]?.userId ?? null,
      }));
    }
  }

  await team.save();
  res.json(team);
};

const deleteTeam = async (req, res) => {
  const team = await Team.findById(req.params.id).populate('competition');
  if (!team) return res.status(404).json({ message: 'Team not found' });
  if (team.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  await team.deleteOne();
  res.json({ message: 'Team deleted' });
};

const updateTeamDivision = async (req, res) => {
  const team = await Team.findById(req.params.id).populate('competition');
  if (!team) return res.status(404).json({ message: 'Team not found' });
  if (team.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const { divisionId } = req.body;

  if (divisionId === null || divisionId === '') {
    team.division = null;
    await team.save();
    return res.json(team);
  }

  const division = await Division.findById(divisionId);
  if (!division) return res.status(404).json({ message: 'Division not found' });
  if (division.competition.toString() !== team.competition._id.toString()) {
    return res.status(400).json({ message: 'Division does not belong to this competition' });
  }
  if (division.seasonName !== team.seasonName) {
    return res.status(400).json({ message: 'Division is not in the active team season' });
  }

  team.division = division._id;
  await team.save();
  res.json(team);
};

module.exports = {
  getDivisionTeams, createDivisionTeam,
  getCompetitionTeams, createCompetitionTeam,
  getCompetitionTeamsDetailed,
  updateTeam, updateTeamDivision, deleteTeam, joinTeam,
};
