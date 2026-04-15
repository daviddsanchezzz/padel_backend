const mongoose = require('mongoose');
const { auth } = require('../lib/auth');
const { fromNodeHeaders } = require('better-auth/node');
const Organization = require('../models/Organization');
const Competition = require('../models/Competition');
const Division = require('../models/Division');
const Team = require('../models/Team');
const Match = require('../models/Match');
const MatchEvent = require('../models/MatchEvent');
const { calculateStandings } = require('../services/standings.service');
const stripe = require('../services/stripe');

const toSlug = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const normalizeOrgName = (value = '') =>
  String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const ensureUniqueSlug = async (baseName, excludeOrgId = null) => {
  const baseSlug = toSlug(baseName) || 'club';
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const existing = await Organization.findOne({ slug: candidate }).select('_id').lean();
    if (!existing || String(existing._id) === String(excludeOrgId)) return candidate;
    candidate = `${baseSlug}-${suffix++}`;
  }
};

const findPublicOrgByRef = async (orgRef) => {
  if (!orgRef) return null;
  const byId = mongoose.Types.ObjectId.isValid(orgRef)
    ? await Organization.findById(orgRef)
    : null;
  if (byId) return byId;
  return Organization.findOne({ slug: String(orgRef).toLowerCase().trim() });
};

// ── POST /api/organizations ──────────────────────────────────────────────────
const createOrganization = async (req, res) => {
  const { name, description, location, type } = req.body;
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!cleanName) return res.status(400).json({ message: 'Name is required' });

  const normalizedName = normalizeOrgName(cleanName);
  const existing = await Organization.findOne({ normalizedName });
  if (existing) return res.status(409).json({ message: 'An organization with this name already exists' });
  const slug = await ensureUniqueSlug(cleanName);

  // 1. Create the organization identity in Better Auth (handles members/roles)
  let authOrg;
  try {
    authOrg = await auth.api.createOrganization({
      body: { name: cleanName, slug },
      headers: fromNodeHeaders(req.headers),
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create organization', detail: err.message });
  }

  // 2. Create domain data record linked to the auth org
  const org = await Organization.create({
    authOrgId: authOrg.id,
    name: cleanName,
    slug,
    description,
    location,
    type: type || 'club',
    ownerId: req.user.id,
  });

  res.status(201).json(org);
};

// ── GET /api/organizations ───────────────────────────────────────────────────
const getMyOrganizations = async (req, res) => {
  const userKeys = [req.user?.id, req.user?._id, req.user?.email]
    .filter(Boolean)
    .map((v) => String(v));

  // Primary: organizations owned by this user in our domain model.
  // We match by several keys to support legacy records where ownerId may differ.
  const owned = await Organization.find({ ownerId: { $in: userKeys } }).sort({ createdAt: -1 });

  // Secondary: organizations where user is a Better Auth member.
  // This is best-effort; if member lookup fails, we still return owned orgs.
  let memberOrgs = [];
  try {
    const members = await mongoose.connection.db
      .collection('member')
      .find({ userId: req.user.id })
      .toArray();
    const memberAuthOrgIds = [...new Set(members.map((m) => m.organizationId).filter(Boolean))];
    if (memberAuthOrgIds.length > 0) {
      memberOrgs = await Organization.find({ authOrgId: { $in: memberAuthOrgIds } });
    }
  } catch {
    memberOrgs = [];
  }

  // Merge + dedupe by authOrgId (or _id fallback), keep newest first.
  const merged = [...owned, ...memberOrgs];
  const seen = new Set();
  const deduped = merged.filter((org) => {
    const key = org.authOrgId || String(org._id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json(deduped);
};

// ── GET /api/organizations/:id ───────────────────────────────────────────────
const getOrganization = async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) return res.status(404).json({ message: 'Organization not found' });

  const userKeys = [req.user?.id, req.user?._id, req.user?.email]
    .filter(Boolean)
    .map((v) => String(v));
  if (userKeys.includes(String(org.ownerId))) {
    return res.json({ ...org.toObject(), memberRole: 'owner' });
  }

  const member = await mongoose.connection.db
    .collection('member')
    .findOne({ organizationId: org.authOrgId, userId: req.user.id });

  if (!member) return res.status(403).json({ message: 'Not a member of this organization' });

  res.json({ ...org.toObject(), memberRole: member.role });
};

// ── GET /api/organizations/:id/public — no auth required ────────────────────
const getPublicOrganization = async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org || !org.isPublic) return res.status(404).json({ message: 'Organization not found' });

  const competitions = await Competition.find({
    organization: org.authOrgId,
    status: 'active',
  })
    .select('name type status seasons sport createdAt')
    .populate('sport', 'name slug')
    .sort({ createdAt: -1 })
    .limit(20);

  res.json({
    id: org._id,
    name: org.name,
    slug: org.slug,
    description: org.description,
    location: org.location,
    type: org.type,
    logo: org.logo,
    primaryColor: org.primaryColor,
    activeCompetitions: competitions,
    createdAt: org.createdAt,
  });
};

// ── GET /api/organizations/public/by-slug/:slug — no auth required ───────────
const getPublicOrganizationBySlug = async (req, res) => {
  const org = await Organization.findOne({ slug: req.params.slug?.toLowerCase().trim() });
  if (!org || !org.isPublic) return res.status(404).json({ message: 'Organization not found' });

  const competitions = await Competition.find({
    organization: org.authOrgId,
    status: 'active',
  })
    .select('name type status seasons sport createdAt')
    .populate('sport', 'name slug')
    .sort({ createdAt: -1 })
    .limit(20);

  res.json({
    id: org._id,
    name: org.name,
    slug: org.slug,
    description: org.description,
    location: org.location,
    type: org.type,
    logo: org.logo,
    primaryColor: org.primaryColor,
    activeCompetitions: competitions,
    createdAt: org.createdAt,
  });
};

// ── PUT /api/organizations/:id ───────────────────────────────────────────────
const updateOrganization = async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) return res.status(404).json({ message: 'Organization not found' });
  if (org.ownerId !== req.user.id) {
    return res.status(403).json({ message: 'Only the owner can update the organization' });
  }

  const { name, description, location, type, logo, isPublic } = req.body;
  if (name !== undefined) {
    const cleanName = String(name).trim().replace(/\s+/g, ' ');
    if (!cleanName) return res.status(400).json({ message: 'Name is required' });

    const normalizedName = normalizeOrgName(cleanName);
    const nameOwner = await Organization.findOne({ normalizedName }).select('_id').lean();
    if (nameOwner && String(nameOwner._id) !== String(org._id)) {
      return res.status(409).json({ message: 'An organization with this name already exists' });
    }
    org.name = cleanName;
  }
  if (description !== undefined) org.description = description;
  if (location !== undefined) org.location = location;
  if (type !== undefined) org.type = type;
  if (logo !== undefined) org.logo = logo;
  if (isPublic !== undefined) org.isPublic = isPublic;
  if (req.body.primaryColor !== undefined) org.primaryColor = req.body.primaryColor;

  await org.save();
  res.json(org);
};

// ── GET /api/organizations/:orgId/competitions/:compId/public ────────────────
const getPublicCompetition = async (req, res) => {
  const org = await findPublicOrgByRef(req.params.orgId);
  if (!org || !org.isPublic) return res.status(404).json({ message: 'Organization not found' });

  const competition = await Competition.findById(req.params.compId)
    .populate('sport', 'name slug scoringType teamSize');
  if (!competition || competition.status !== 'active') return res.status(404).json({ message: 'Competition not found' });
  if (competition.organization !== org.authOrgId) return res.status(404).json({ message: 'Competition not found' });

  const activeSeason = competition.seasons?.find((s) => s.isActive);
  let divisions = [];
  if (activeSeason) {
    divisions = await Division.find({
      competition: competition._id,
      seasonName: activeSeason.name,
    }).sort({ order: 1, createdAt: 1 });
  }

  res.json({ org: { id: org._id, slug: org.slug, name: org.name, logo: org.logo, primaryColor: org.primaryColor }, competition, divisions });
};

// ── GET /api/organizations/:orgId/divisions/:divId/public ────────────────────
const getPublicDivision = async (req, res) => {
  const org = await findPublicOrgByRef(req.params.orgId);
  if (!org || !org.isPublic) return res.status(404).json({ message: 'Organization not found' });

  const division = await Division.findById(req.params.divId).populate({
    path: 'competition',
    select: 'name type settings sport organizer organization status seasons',
    populate: { path: 'sport', select: 'name scoringType teamSize' },
  });
  if (!division) return res.status(404).json({ message: 'Division not found' });

  const competition = division.competition;
  if (!competition || competition.status !== 'active') return res.status(404).json({ message: 'Not found' });
  if (competition.organization !== org.authOrgId) return res.status(404).json({ message: 'Not found' });

  const isTournament = competition.type === 'tournament';
  const tournamentFormat = competition.settings?.tournamentFormat || 'elimination';
  const isGroupFormat = isTournament && tournamentFormat === 'groups_and_elimination';

  const allDivisions = await Division.find({
    competition: competition._id,
    seasonName: division.seasonName,
  }).sort({ order: 1, createdAt: 1 });

  const teams = await Team.find({ division: division._id }).sort({ createdAt: 1 });

  const populateMatch = (query) =>
    query
      .populate('teamA', 'name players playerNames')
      .populate('teamB', 'name players playerNames')
      .populate('winner', 'name');

  let matches = [], standings = [], bracket = {}, groups = [];

  if (isTournament) {
    if (isGroupFormat) {
      // Group-phase matches
      const { computeStandings } = require('../services/group.service');
      const scoringType = competition.sport?.scoringType || 'sets';

      const groupMatches = await populateMatch(
        Match.find({ division: division._id, phase: 'group' }).sort({ group: 1, round: 1 })
      );
      const bracketMatches = await populateMatch(
        Match.find({ division: division._id, phase: 'bracket' }).sort({ round: 1, bracketPosition: 1 })
      );

      // Build groups
      const byGroup = {};
      for (const team of teams) {
        if (!team.group) continue;
        if (!byGroup[team.group]) byGroup[team.group] = { teams: [], matches: [] };
        byGroup[team.group].teams.push(team);
      }
      for (const match of groupMatches) {
        if (match.group && byGroup[match.group]) byGroup[match.group].matches.push(match);
      }
      groups = Object.keys(byGroup).sort().map((name) => ({
        name,
        teams: byGroup[name].teams,
        matches: byGroup[name].matches,
        standings: computeStandings(byGroup[name].teams, byGroup[name].matches, scoringType),
      }));

      bracketMatches.forEach((m) => {
        if (!bracket[m.round]) bracket[m.round] = [];
        bracket[m.round].push(m);
      });
    } else {
      const raw = await populateMatch(
        Match.find({ division: division._id }).sort({ round: 1, bracketPosition: 1 })
      );
      raw.forEach((m) => {
        if (!bracket[m.round]) bracket[m.round] = [];
        bracket[m.round].push(m);
      });
    }
  } else {
    matches = await populateMatch(
      Match.find({ division: division._id }).sort({ round: 1, bracketPosition: 1 })
    );
    standings = await calculateStandings(division._id);
  }

  res.json({
    org: { id: org._id, slug: org.slug, name: org.name, authOrgId: org.authOrgId, logo: org.logo, primaryColor: org.primaryColor },
    division,
    allDivisions,
    teams,
    matches,
    standings,
    bracket,
    groups,
    tournamentFormat,
  });
};

// â”€â”€ GET /api/organizations/:orgId/matches/:matchId/public â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getPublicMatchDetail = async (req, res) => {
  const org = await findPublicOrgByRef(req.params.orgId);
  if (!org || !org.isPublic) return res.status(404).json({ message: 'Organization not found' });

  const match = await Match.findById(req.params.matchId)
    .populate('teamA', 'name players playerNames')
    .populate('teamB', 'name players playerNames')
    .populate('winner', 'name')
    .populate({ path: 'division', select: 'name competition seasonName' })
    .populate({
      path: 'competition',
      select: 'name type settings organizer organization status sport',
      populate: { path: 'sport', select: 'name slug scoringType teamSize' },
    });

  if (!match || !match.competition || match.competition.status !== 'active') {
    return res.status(404).json({ message: 'Match not found' });
  }
  if (match.competition.organization !== org.authOrgId) {
    return res.status(404).json({ message: 'Match not found' });
  }

  const events = await MatchEvent.find({ match: match._id }).sort({ order: 1, minute: 1, createdAt: 1 });

  res.json({
    org: { id: org._id, slug: org.slug, name: org.name, authOrgId: org.authOrgId, logo: org.logo, primaryColor: org.primaryColor },
    match,
    events,
  });
};

// ── POST /api/organizations/:orgId/competitions/:compId/register ─────────────
const registerForCompetition = async (req, res) => {
  const org = await findPublicOrgByRef(req.params.orgId);
  if (!org || !org.isPublic) return res.status(404).json({ message: 'Not found' });

  const competition = await Competition.findById(req.params.compId)
    .populate('sport', 'name scoringType teamSize');
  if (!competition || competition.status !== 'active') return res.status(404).json({ message: 'Not found' });
  if (competition.organization !== org.authOrgId) return res.status(404).json({ message: 'Not found' });

  const { divisionId, players, contactEmail } = req.body;
  if (!divisionId) return res.status(400).json({ message: 'Categoría requerida' });

  const division = await Division.findById(divisionId);
  if (!division || division.competition.toString() !== competition._id.toString()) {
    return res.status(404).json({ message: 'Categoría no encontrada' });
  }

  // Check capacity
  const maxTeams = competition.settings?.maxTeamsPerDivision || 0;
  if (maxTeams > 0) {
    const currentCount = await Team.countDocuments({ division: division._id });
    if (currentCount >= maxTeams) {
      return res.status(409).json({ message: 'Esta categoría está completa. No quedan plazas disponibles.' });
    }
  }

  // Validate players
  const teamSize = division.teamSize || competition.sport?.teamSize || 1;
  const playerList = (players || [])
    .slice(0, teamSize)
    .map((p) => ({ name: typeof p === 'string' ? p.trim() : (p.name || '').trim() }))
    .filter((p) => p.name);

  if (playerList.length !== teamSize) {
    return res.status(400).json({ message: `Se requieren exactamente ${teamSize} jugador${teamSize > 1 ? 'es' : ''}` });
  }

  const teamName = playerList.map((p) => p.name).join(' / ');
  const activeSeason = competition.seasons?.find((s) => s.isActive);
  const registrationFee = Number(competition.settings?.registrationFee) || 0;
  const requiresPayment = stripe && registrationFee > 0;

  // Guard against duplicate paid registrations (same player names, same division, paid)
  if (requiresPayment) {
    const existingPaid = await Team.findOne({
      division: division._id,
      name: teamName,
      paymentStatus: 'paid',
    });
    if (existingPaid) {
      return res.status(409).json({ message: 'Ya existe una inscripción pagada con estos nombres en esta categoría.' });
    }
  }

  const team = await Team.create({
    name: teamName,
    players: playerList,
    competition: competition._id,
    division: division._id,
    seasonName: activeSeason?.name || 'Temporada 1',
    contactEmail: contactEmail?.trim() || null,
    paymentStatus: requiresPayment ? 'pending' : 'free',
  });

  // Free registration — done
  if (!requiresPayment) {
    return res.status(201).json({ message: '¡Inscripción completada!', team, requiresPayment: false });
  }

  // Paid registration — create Stripe Checkout session
  const frontendUrl = process.env.FRONTEND_URL?.split(',')[0]?.trim() || 'http://localhost:5173';

  // Build session params — route payment to the org's connected Stripe account if available
  const sessionParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(registrationFee * 100),
          product_data: {
            name: `Inscripción · ${competition.name}`,
            description: `${division.name} — ${teamName}`,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: contactEmail?.trim() || undefined,
    success_url: `${frontendUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${frontendUrl}/payment/cancel?team_id=${team._id}`,
    metadata: {
      teamId:         team._id.toString(),
      competitionId:  competition._id.toString(),
      divisionId:     division._id.toString(),
      organizationId: org._id.toString(),
    },
  };

  // If the org has a fully verified Connect account, route funds directly to them
  if (org.stripeAccountId && org.stripeConnectActive) {
    sessionParams.transfer_data = { destination: org.stripeAccountId };
    // application_fee_amount can be added here in the future for Option B (commission)
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  team.stripeCheckoutSessionId = session.id;
  await team.save();

  res.status(201).json({ requiresPayment: true, checkoutUrl: session.url, teamId: team._id });
};

module.exports = {
  createOrganization,
  getMyOrganizations,
  getOrganization,
  getPublicOrganization,
  getPublicOrganizationBySlug,
  getPublicCompetition,
  getPublicDivision,
  getPublicMatchDetail,
  updateOrganization,
  registerForCompetition,
};
