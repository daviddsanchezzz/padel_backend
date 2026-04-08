const Competition = require('../models/Competition');
const Division = require('../models/Division');
const Team = require('../models/Team');
const Sport = require('../models/Sport');
const { calculateStandings } = require('../services/standings.service');

// ── Helpers ──────────────────────────────────────────────────────────────────
const autoNextSeason = (season) => {
  if (!season) return 'Temporada 2';
  const dashMatch = season.match(/^(\d{4})-(\d{2})$/);
  if (dashMatch) {
    const y = parseInt(dashMatch[1]) + 1;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  }
  const yearMatch = season.match(/^(\d{4})$/);
  if (yearMatch) return String(parseInt(yearMatch[1]) + 1);
  const numMatch = season.match(/^(.+?)(\d+)$/);
  if (numMatch) return `${numMatch[1]}${parseInt(numMatch[2]) + 1}`;
  return `${season} 2`;
};

const getCompetitions = async (req, res) => {
  const competitions = await Competition.find({ organizer: req.user._id })
    .populate('sport', 'name slug scoringType')
    .sort({ createdAt: -1 });
  res.json(competitions);
};

const getPlayerCompetitions = async (req, res) => {
  const teams = await Team.find({ players: req.user._id })
    .populate({ path: 'competition', select: 'name type sport status seasons organizer', populate: [{ path: 'organizer', select: 'name' }, { path: 'sport', select: 'name slug' }] })
    .populate('division', 'name');
  const competitions = [...new Map(teams.map(t => [t.competition._id.toString(), t.competition])).values()];
  res.json(competitions);
};

const getCompetition = async (req, res) => {
  const competition = await Competition.findById(req.params.id)
    .populate('sport', 'name slug scoringType teamSize defaultSettings');
  if (!competition) return res.status(404).json({ message: 'Competition not found' });
  res.json(competition);
};

const createCompetition = async (req, res) => {
  const { name, type, sportId, description, settings } = req.body;

  if (!name)    return res.status(400).json({ message: 'Name is required' });
  if (!type)    return res.status(400).json({ message: 'Type is required (league | tournament)' });
  if (!sportId) return res.status(400).json({ message: 'Sport is required' });

  const sport = await Sport.findById(sportId);
  if (!sport) return res.status(404).json({ message: 'Sport not found' });

  // Merge sport defaults with provided settings
  const mergedSettings = { ...sport.defaultSettings, ...(settings || {}) };

  const competition = await Competition.create({
    name,
    type,
    sport: sportId,
    organizer: req.user._id,
    seasons: [{ name: 'Temporada 1', isActive: true }],
    description,
    settings: mergedSettings,
  });

  await competition.populate('sport', 'name slug scoringType teamSize');
  res.status(201).json(competition);
};

const updateCompetition = async (req, res) => {
  const competition = await Competition.findOneAndUpdate(
    { _id: req.params.id, organizer: req.user._id },
    req.body,
    { new: true, runValidators: true }
  ).populate('sport', 'name slug scoringType');
  if (!competition) return res.status(404).json({ message: 'Competition not found' });
  res.json(competition);
};

const deleteCompetition = async (req, res) => {
  const competition = await Competition.findOneAndDelete({
    _id: req.params.id,
    organizer: req.user._id,
  });
  if (!competition) return res.status(404).json({ message: 'Competition not found' });
  res.json({ message: 'Competition deleted' });
};

// ── New season (league only) ─────────────────────────────────────────────────
const buildSeasonPlan = async (competitionId) => {
  const competition = await Competition.findById(competitionId);
  const settings = competition.settings || {};
  const promotionSpots  = settings.promotionSpots  || 0;
  const relegationSpots = settings.relegationSpots || 0;

  const divisions = await Division.find({ competition: competitionId }).sort({ order: 1 });
  const allStandings = await Promise.all(divisions.map((d) => calculateStandings(d._id)));

  const toPromote  = [];  // toPromote[i]  = top teams from div i going UP   (to i-1)
  const toRelegate = [];  // toRelegate[i] = bottom teams from div i going DOWN (to i+1)
  const staying    = [];  // staying[i]    = teams remaining in div i

  for (let i = 0; i < divisions.length; i++) {
    const st = allStandings[i];
    const n  = st.length;
    const canUp   = i === 0                    ? 0 : Math.min(promotionSpots,  Math.floor(n / 2));
    const canDown = i === divisions.length - 1 ? 0 : Math.min(relegationSpots, Math.floor((n - canUp) / 2));
    toPromote.push(st.slice(0, canUp));
    toRelegate.push(canDown > 0 ? st.slice(n - canDown) : []);
    staying.push(st.slice(canUp, canDown > 0 ? n - canDown : n));
  }

  return { divisions, toPromote, toRelegate, staying, nextSeason: autoNextSeason(competition.season) };
};

const getNewSeasonPreview = async (req, res) => {
  const competition = await Competition.findOne({ _id: req.params.id, organizer: req.user._id });
  if (!competition) return res.status(404).json({ message: 'Competition not found' });
  if (competition.type !== 'league') return res.status(400).json({ message: 'Only for leagues' });

  const plan = await buildSeasonPlan(req.params.id);

  const preview = plan.divisions.map((div, i) => ({
    division: { _id: div._id, name: div.name, order: div.order },
    promoted:  plan.toPromote[i].map((s) => ({ _id: s.team._id, name: s.team.name, position: s.position })),
    relegated: plan.toRelegate[i].map((s) => ({ _id: s.team._id, name: s.team.name, position: s.position })),
    staying:   plan.staying[i].map((s) => ({ _id: s.team._id, name: s.team.name, position: s.position })),
  }));

  res.json({ nextSeason: plan.nextSeason, divisions: preview });
};

const createNewSeason = async (req, res) => {
  const competition = await Competition.findOne({ _id: req.params.id, organizer: req.user._id });
  if (!competition) return res.status(404).json({ message: 'Competition not found' });
  if (competition.type !== 'league') return res.status(400).json({ message: 'Only for leagues' });

  // Get the last active season
  const lastActiveSeason = competition.seasons.find((s) => s.isActive);
  if (!lastActiveSeason) return res.status(400).json({ message: 'No active season found' });

  // Build promotion/relegation plan from last season
  const divisions = await Division.find({ competition: req.params.id, seasonName: lastActiveSeason.name }).sort({ order: 1 });
  const allStandings = await Promise.all(divisions.map((d) => calculateStandings(d._id)));

  const settings = competition.settings || {};
  const promotionSpots  = settings.promotionSpots  || 0;
  const relegationSpots = settings.relegationSpots || 0;

  const toPromote  = [];
  const toRelegate = [];
  const staying    = [];

  for (let i = 0; i < divisions.length; i++) {
    const st = allStandings[i];
    const n  = st.length;
    const canUp   = i === 0                    ? 0 : Math.min(promotionSpots,  Math.floor(n / 2));
    const canDown = i === divisions.length - 1 ? 0 : Math.min(relegationSpots, Math.floor((n - canUp) / 2));
    toPromote.push(st.slice(0, canUp));
    toRelegate.push(canDown > 0 ? st.slice(n - canDown) : []);
    staying.push(st.slice(canUp, canDown > 0 ? n - canDown : n));
  }

  // Generate next season name (Temporada 2, 3, etc)
  const nextSeasonNum = competition.seasons.length + 1;
  const newSeasonName = `Temporada ${nextSeasonNum}`;

  // Add new season to array and mark as active
  competition.seasons.forEach((s) => (s.isActive = false));
  competition.seasons.push({ name: newSeasonName, isActive: true });
  await competition.save();

  // Create new divisions with updated teams
  for (let i = 0; i < divisions.length; i++) {
    const newDiv = await Division.create({
      name: divisions[i].name,
      competition: req.params.id,
      order: divisions[i].order,
      seasonName: newSeasonName,
    });

    // Teams for new division: staying + relegated from above + promoted from below
    const teamsHere = [
      ...staying[i],
      ...(i > 0                        ? toRelegate[i - 1] : []),
      ...(i < divisions.length - 1 ? toPromote[i + 1]  : []),
    ];

    await Promise.all(teamsHere.map((s) =>
      Team.create({
        name: s.team.name,
        player1Name: s.team.player1Name || null,
        player2Name: s.team.player2Name || null,
        competition: req.params.id,
        division: newDiv._id,
        players: s.team.players || [],
        seasonName: newSeasonName,
      })
    ));
  }

  await competition.populate('sport', 'name slug scoringType');
  res.status(201).json(competition);
};

module.exports = {
  getCompetitions, getCompetition, getPlayerCompetitions,
  createCompetition, updateCompetition, deleteCompetition,
  getNewSeasonPreview, createNewSeason,
};
