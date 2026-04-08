const Team = require('../models/Team');
const Division = require('../models/Division');
const Competition = require('../models/Competition');

const normalizePlayerNames = (playerNames) => {
  if (!Array.isArray(playerNames)) return [];
  return playerNames
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean);
};

const resolveTeamSize = ({ competition, division }) => {
  const fromDivision = division?.teamSize;
  const fromCompetition = competition?.settings?.teamSize;
  const fromSport = competition?.sport?.teamSize;
  return Number(fromDivision ?? fromCompetition ?? fromSport ?? 1);
};

// League teams (scoped to a division)
const getDivisionTeams = async (req, res) => {
  const division = await Division.findById(req.params.divisionId);
  if (!division) return res.status(404).json({ message: 'Division not found' });

  const teams = await Team.find({ division: req.params.divisionId, seasonName: division.seasonName })
    .populate('players', 'name email');
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
  const pNames = normalizePlayerNames(playerNames);

  let teamName = trimmedName;
  let storedPlayerNames = [];

  if (teamSize <= 2) {
    if (pNames.length !== teamSize) {
      return res.status(400).json({ message: `Debe proporcionar exactamente ${teamSize} ${teamSize === 1 ? 'nombre de jugador' : 'nombres de jugadores'}` });
    }
    storedPlayerNames = pNames;
    teamName = pNames.join(' / ');
  } else if (!trimmedName) {
    return res.status(400).json({ message: 'Nombre del equipo es requerido' });
  }

  const team = await Team.create({
    name: teamName,
    playerNames: storedPlayerNames,
    competition: division.competition._id,
    division: divisionId,
    seasonName: division.seasonName,
    players: teamSize <= 2 ? new Array(teamSize).fill(null) : [],
  });

  await team.populate('players', 'name email');
  res.status(201).json(team);
};

// Tournament teams (scoped to competition, no division)
const getCompetitionTeams = async (req, res) => {
  const competition = await Competition.findById(req.params.competitionId);
  if (!competition) return res.status(404).json({ message: 'Competition not found' });

  const activeSeason = competition.seasons.find((s) => s.isActive);
  if (!activeSeason) return res.status(404).json({ message: 'No active season' });

  const teams = await Team.find({ competition: req.params.competitionId, division: null, seasonName: activeSeason.name })
    .populate('players', 'name email');
  res.json(teams);
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
  const pNames = normalizePlayerNames(playerNames);

  let teamName = trimmedName;
  let storedPlayerNames = [];

  if (teamSize <= 2) {
    if (pNames.length !== teamSize) {
      return res.status(400).json({ message: `Debe proporcionar exactamente ${teamSize} ${teamSize === 1 ? 'nombre de jugador' : 'nombres de jugadores'}` });
    }
    storedPlayerNames = pNames;
    teamName = pNames.join(' / ');
  } else if (!trimmedName) {
    return res.status(400).json({ message: 'Nombre del equipo es requerido' });
  }

  const team = await Team.create({
    name: teamName,
    playerNames: storedPlayerNames,
    competition: competitionId,
    division: null,
    seasonName: activeSeason.name,
    players: teamSize <= 2 ? new Array(teamSize).fill(null) : [],
    seed: seed || null,
  });

  await team.populate('players', 'name email');
  res.status(201).json(team);
};

// Player joining teams
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

  const userId = req.user._id.toString();
  const userAlreadyInTeam = team.players.some((playerId) => playerId && playerId.toString() === userId);
  if (userAlreadyInTeam) {
    return res.status(400).json({ message: 'Ya estás en este equipo' });
  }

  const scopeQuery = team.division
    ? { division: team.division._id, seasonName: team.seasonName }
    : { competition: team.competition._id, division: null, seasonName: team.seasonName };

  const otherTeams = await Team.find({ ...scopeQuery, _id: { $ne: id } });
  const userInOtherTeam = otherTeams.some((t) => t.players.some((playerId) => playerId && playerId.toString() === userId));
  if (userInOtherTeam) {
    return res.status(400).json({ message: 'Ya estás en otro equipo en esta división' });
  }

  if (!team.playerNames[position]) {
    return res.status(400).json({ message: `La posición ${position} no está disponible para este equipo` });
  }

  if (team.players[position]) {
    return res.status(400).json({ message: `La posición ${position} ya está ocupada` });
  }

  team.players[position] = req.user._id;
  await team.save();

  await team.populate('players', 'name email');
  res.json(team);
};

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

    const pNames = normalizePlayerNames(req.body.playerNames);
    if (pNames.length !== teamSize) {
      return res.status(400).json({ message: `Debe proporcionar exactamente ${teamSize} ${teamSize === 1 ? 'nombre de jugador' : 'nombres de jugadores'}` });
    }

    team.playerNames = pNames;
    team.name = pNames.join(' / ');

    if (!Array.isArray(team.players) || team.players.length < teamSize) {
      team.players = new Array(teamSize).fill(null);
    }
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
      const pNames = normalizePlayerNames(req.body.playerNames);
      if (pNames.length > teamSize) {
        return res.status(400).json({ message: `No puede haber más de ${teamSize} jugadores` });
      }

      team.playerNames = pNames;
      team.players = (Array.isArray(team.players) ? team.players : []).slice(0, pNames.length);
    }
  }

  await team.save();
  await team.populate('players', 'name email');
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

module.exports = {
  getDivisionTeams, createDivisionTeam,
  getCompetitionTeams, createCompetitionTeam,
  updateTeam, deleteTeam, joinTeam,
};
