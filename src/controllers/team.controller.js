const Team = require('../models/Team');
const Division = require('../models/Division');
const Competition = require('../models/Competition');

// ── League teams (scoped to a division) ─────────────────────────────────────
const getDivisionTeams = async (req, res) => {
  const division = await Division.findById(req.params.divisionId);
  if (!division) return res.status(404).json({ message: 'Division not found' });
  
  const teams = await Team.find({ division: req.params.divisionId, seasonName: division.seasonName })
    .populate('players', 'name email');
  res.json(teams);
};

const createDivisionTeam = async (req, res) => {
  const { divisionId } = req.params;
  const { name, playerNames, players } = req.body;
  
  const division = await Division.findById(divisionId).populate({ path: 'competition', populate: { path: 'sport' } });
  if (!division) return res.status(404).json({ message: 'Division not found' });
  if (division.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  // Use division's teamSize if set, otherwise use sport's teamSize
  const teamSize = division.teamSize ?? division.competition.sport.teamSize || 1;
  let teamName = name;
  let pNames = [];

  // For teamSize <= 2, use playerNames; for teamSize > 2, use teamName
  if (teamSize <= 2) {
    if (playerNames && playerNames.length > 0) {
      if (playerNames.length !== teamSize) {
        return res.status(400).json({ message: `Debe proporcionar exactamente ${teamSize} ${teamSize === 1 ? 'nombre de jugador' : 'nombres de jugadores'}` });
      }
      pNames = playerNames.map(n => n.trim());
      teamName = pNames.join(' / ');
    } else if (!name) {
      return res.status(400).json({ message: 'Nombre del equipo o nombres de jugadores son requeridos' });
    }
  } else {
    // For larger teams, just use the team name
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Nombre del equipo es requerido' });
    }
    teamName = name.trim();
  }

  const team = await Team.create({
    name: teamName,
    playerNames: pNames,
    competition: division.competition._id,
    division: divisionId,
    seasonName: division.seasonName,
    players: teamSize > 2 ? [] : new Array(teamSize).fill(null),
  });
  await team.populate('players', 'name email');
  res.status(201).json(team);
};

// ── Tournament teams (scoped to competition, no division) ────────────────────
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
  const { name, playerNames, players, seed } = req.body;
  
  const competition = await Competition.findOne({ _id: competitionId, organizer: req.user._id }).populate('sport');
  if (!competition) return res.status(404).json({ message: 'Competition not found' });
  
  const activeSeason = competition.seasons.find((s) => s.isActive);
  if (!activeSeason) return res.status(400).json({ message: 'No active season' });

  const teamSize = competition.sport.teamSize || 1;
  let teamName = name;
  let pNames = [];

  if (playerNames && playerNames.length > 0) {
    if (playerNames.length !== teamSize) {
      return res.status(400).json({ message: `Debe proporcionar exactamente ${teamSize} ${teamSize === 1 ? 'nombre de jugador' : 'nombres de jugadores'}` });
    }
    pNames = playerNames.map(n => n.trim());
    teamName = pNames.join(' / ');
  } else if (!name) {
    return res.status(400).json({ message: 'Nombre del equipo o nombres de jugadores son requeridos' });
  }

  const team = await Team.create({
    name: teamName,
    playerNames: pNames,
    competition: competitionId,
    division: null,
    seasonName: activeSeason.name,
    players: pNames.length > 0 ? new Array(pNames.length).fill(null) : [],
    seed: seed || null,
  });
  await team.populate('players', 'name email');
  res.status(201).json(team);
};

// ── Player joining teams ───────────────────────────────────────────────────
const joinTeam = async (req, res) => {
  const { id } = req.params;
  const { position } = req.body; // position index (0, 1, 2, etc.)
  
  const team = await Team.findById(id).populate({ path: 'competition', populate: { path: 'sport' } }).populate('division');
  if (!team) return res.status(404).json({ message: 'Team not found' });
  
  const teamSize = team.competition.sport.teamSize || 1;
  if (position < 0 || position >= teamSize) {
    return res.status(400).json({ message: `Posición inválida. Debe ser entre 0 y ${teamSize - 1}` });
  }
  
  // Check if user is already in this team
  if (team.players.includes(req.user._id)) {
    return res.status(400).json({ message: 'Ya estás en este equipo' });
  }
  
  // Check if user is already in any team in the same division/competition
  const otherTeams = await Team.find({
    $or: [
      { division: team.division }, // league format: same division
      { competition: team.competition, division: null }, // tournament format: same competition, no division
    ],
    _id: { $ne: id },
  });
  
  const userInOtherTeam = otherTeams.some(t => t.players.includes(req.user._id));
  if (userInOtherTeam) {
    return res.status(400).json({ message: 'Ya estás en otro equipo en esta división' });
  }
  
  // Check if the position is available
  if (!team.playerNames[position]) {
    return res.status(400).json({ message: `La posición ${position} no está disponible para este equipo` });
  }
  
  // Check if position is already taken
  if (team.players[position]) {
    return res.status(400).json({ message: `La posición ${position} ya está ocupada` });
  }
  
  // Assign user to position
  team.players[position] = req.user._id;
  await team.save();
  
  await team.populate('players', 'name email');
  res.json(team);
};

const updateTeam = async (req, res) => {
  const team = await Team.findById(req.params.id)
    .populate({ path: 'competition' });
  if (!team) return res.status(404).json({ message: 'Team not found' });
  if (team.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  
  // Only allow updating the team name
  if (req.body.name) {
    team.name = req.body.name.trim();
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
