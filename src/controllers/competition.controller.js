const Competition = require('../models/Competition');
const Division = require('../models/Division');
const Team = require('../models/Team');
const Sport = require('../models/Sport');
const { calculateStandings } = require('../services/standings.service');

const normalizeSportName = (value = '') =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const toSlug = (value = '') =>
  String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'competicion';

const cleanName = (value = '') => String(value).trim().replace(/\s+/g, ' ');

const ensureUniqueCompetitionSlug = async ({ organization, baseName, excludeCompetitionId = null }) => {
  const baseSlug = toSlug(baseName);
  const orgKey = organization || null;
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const existing = await Competition.findOne({ organization: orgKey, publicSlug: candidate }).select('_id').lean();
    if (!existing || String(existing._id) === String(excludeCompetitionId)) return candidate;
    candidate = `${baseSlug}-${suffix++}`;
  }
};

const isFootballSport = (sport) => {
  const slug = (sport?.slug || '').toLowerCase();
  const name = normalizeSportName(sport?.name || '');
  return slug === 'football' || name.includes('futbol') || name.includes('football');
};

const isTennisSport = (sport) => {
  const slug = (sport?.slug || '').toLowerCase();
  const name = normalizeSportName(sport?.name || '');
  return slug === 'tennis' || name.includes('tenis') || name.includes('tennis');
};

const normaliseResultConfig = (settings = {}) => {
  const current = settings.resultConfig || {};
  const mode = current.mode === 'events' ? 'events' : 'manual';
  const enabledEventTypes = Array.isArray(current.enabledEventTypes)
    ? current.enabledEventTypes.filter((t) => ['goal', 'assist', 'yellow_card', 'red_card'].includes(t))
    : ['goal', 'assist', 'yellow_card', 'red_card'];
  return { mode, enabledEventTypes };
};

const normalizeMaxTeamsPerDivision = (settings = {}) => {
  const raw = settings.maxTeamsPerDivision;
  if (raw === undefined || raw === null || raw === '') return undefined;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 128) return null;
  return parsed;
};

const isValidDateString = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const normalizeCompetitionMeta = ({ location, startDate, endDate }) => {
  const nextLocation = typeof location === 'string' ? location.trim() : '';
  const nextStartDate = typeof startDate === 'string' ? startDate.trim() : '';
  const nextEndDate = typeof endDate === 'string' ? endDate.trim() : '';

  if (nextLocation.length > 140) {
    return { ok: false, message: 'La ubicacion no puede superar 140 caracteres' };
  }
  if (nextStartDate && !isValidDateString(nextStartDate)) {
    return { ok: false, message: 'Fecha invalida (formato: YYYY-MM-DD)' };
  }
  if (nextEndDate && !isValidDateString(nextEndDate)) {
    return { ok: false, message: 'Fecha fin invalida (formato: YYYY-MM-DD)' };
  }
  if (nextStartDate && nextEndDate && nextEndDate < nextStartDate) {
    return { ok: false, message: 'La fecha fin no puede ser menor que la fecha inicio' };
  }

  return { ok: true, location: nextLocation, startDate: nextStartDate, endDate: nextEndDate };
};

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
  // organizer is now a Better Auth string ID — no populate possible, it's returned as-is
  const teams = await Team.find({ 'players.userId': req.user.id })
    .populate({ path: 'competition', select: 'name type sport status seasons organizer', populate: { path: 'sport', select: 'name slug' } })
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
  const { name, type, sportId, description, settings, season, organizationId, location, startDate, endDate } = req.body;

  const normalizedName = cleanName(name);
  if (!normalizedName) return res.status(400).json({ message: 'Name is required' });
  if (!type)    return res.status(400).json({ message: 'Type is required (league | tournament)' });
  if (!sportId) return res.status(400).json({ message: 'Sport is required' });

  const sport = await Sport.findById(sportId);
  if (!sport) return res.status(404).json({ message: 'Sport not found' });
  const requestedTeamSize = Number(settings?.teamSize);
  const hasTeamSize = settings?.teamSize !== undefined && settings?.teamSize !== null && settings?.teamSize !== '';

  if (isFootballSport(sport)) {
    if (!hasTeamSize || !Number.isInteger(requestedTeamSize) || requestedTeamSize < 3 || requestedTeamSize > 30) {
      return res.status(400).json({ message: 'En f\u00fatbol debe indicar un m\u00e1ximo de jugadores por equipo (3-30)' });
    }
  }

  if (isTennisSport(sport)) {
    if (!hasTeamSize || !Number.isInteger(requestedTeamSize) || ![1, 2].includes(requestedTeamSize)) {
      return res.status(400).json({ message: 'En tenis debe indicar si es individual (1) o dobles (2)' });
    }
  }

  if (!isFootballSport(sport) && !isTennisSport(sport) && hasTeamSize) {
    if (!Number.isInteger(requestedTeamSize) || requestedTeamSize < 1 || requestedTeamSize > 30) {
      return res.status(400).json({ message: 'Tama\u00f1o de equipo inv\u00e1lido' });
    }
  }

  // Merge sport defaults with provided settings
  const mergedSettings = {
    ...sport.defaultSettings,
    resultConfig: { mode: 'manual', enabledEventTypes: ['goal', 'assist', 'yellow_card', 'red_card'] },
    ...(settings || {}),
  };
  mergedSettings.resultConfig = normaliseResultConfig(mergedSettings);
  const normalizedMaxTeams = normalizeMaxTeamsPerDivision(mergedSettings);
  if (normalizedMaxTeams === null) {
    return res.status(400).json({ message: 'El maximo de equipos por division/categoria debe ser un entero entre 0 y 128' });
  }
  if (normalizedMaxTeams !== undefined) {
    mergedSettings.maxTeamsPerDivision = normalizedMaxTeams;
  }

  if (mergedSettings.resultConfig.mode === 'events' && sport.scoringType !== 'goals') {
    return res.status(400).json({ message: 'El modo de eventos detallados solo esta soportado para deportes de goles' });
  }

  const meta = normalizeCompetitionMeta({ location, startDate, endDate });
  if (!meta.ok) {
    return res.status(400).json({ message: meta.message });
  }

  const organizationKey = organizationId || null;
  const publicSlug = await ensureUniqueCompetitionSlug({ organization: organizationKey, baseName: normalizedName });

  const competition = await Competition.create({
    name: normalizedName,
    publicSlug,
    type,
    sport: sportId,
    organizer: req.user._id,
    organization: organizationKey,
    seasons: [{ name: season?.trim() || 'Temporada 1', isActive: true }],
    description,
    location: meta.location,
    startDate: meta.startDate,
    endDate: meta.endDate,
    settings: mergedSettings,
  });

  await competition.populate('sport', 'name slug scoringType teamSize');
  res.status(201).json(competition);
};

const updateCompetition = async (req, res) => {
  const existing = await Competition.findOne({ _id: req.params.id, organizer: req.user._id }).populate('sport');
  if (!existing) return res.status(404).json({ message: 'Competition not found' });

  if (Object.prototype.hasOwnProperty.call(req.body, 'name')) {
    const normalizedName = cleanName(req.body.name);
    if (!normalizedName) {
      return res.status(400).json({ message: 'Name is required' });
    }
    req.body.name = normalizedName;
    req.body.publicSlug = await ensureUniqueCompetitionSlug({
      organization: existing.organization || null,
      baseName: normalizedName,
      excludeCompetitionId: existing._id,
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(req.body, 'location') ||
    Object.prototype.hasOwnProperty.call(req.body, 'startDate') ||
    Object.prototype.hasOwnProperty.call(req.body, 'endDate')
  ) {
    const meta = normalizeCompetitionMeta({
      location: Object.prototype.hasOwnProperty.call(req.body, 'location') ? req.body.location : existing.location,
      startDate: Object.prototype.hasOwnProperty.call(req.body, 'startDate') ? req.body.startDate : existing.startDate,
      endDate: Object.prototype.hasOwnProperty.call(req.body, 'endDate') ? req.body.endDate : existing.endDate,
    });
    if (!meta.ok) {
      return res.status(400).json({ message: meta.message });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'location')) req.body.location = meta.location;
    if (Object.prototype.hasOwnProperty.call(req.body, 'startDate')) req.body.startDate = meta.startDate;
    if (Object.prototype.hasOwnProperty.call(req.body, 'endDate')) req.body.endDate = meta.endDate;
  }

  if (req.body?.settings) {
    const mergedSettings = { ...(existing.settings || {}), ...req.body.settings };
    mergedSettings.resultConfig = normaliseResultConfig(mergedSettings);
    const normalizedMaxTeams = normalizeMaxTeamsPerDivision(mergedSettings);
    if (normalizedMaxTeams === null) {
      return res.status(400).json({ message: 'El maximo de equipos por division/categoria debe ser un entero entre 0 y 128' });
    }
    if (normalizedMaxTeams !== undefined) {
      mergedSettings.maxTeamsPerDivision = normalizedMaxTeams;
    }
    if (mergedSettings.resultConfig.mode === 'events' && existing.sport?.scoringType !== 'goals') {
      return res.status(400).json({ message: 'El modo de eventos detallados solo esta soportado para deportes de goles' });
    }
    req.body.settings = mergedSettings;
  }

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
