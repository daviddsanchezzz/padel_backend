const mongoose = require('mongoose');
const { auth } = require('../lib/auth');
const { fromNodeHeaders } = require('better-auth/node');
const Organization = require('../models/Organization');
const Competition = require('../models/Competition');
const Division = require('../models/Division');
const Team = require('../models/Team');
const Match = require('../models/Match');
const { calculateStandings } = require('../services/standings.service');

const toSlug = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ── POST /api/organizations ──────────────────────────────────────────────────
const createOrganization = async (req, res) => {
  const { name, description, location, type } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });

  const slug = toSlug(name);
  const existing = await Organization.findOne({ slug });
  if (existing) return res.status(409).json({ message: 'An organization with this name already exists' });

  // 1. Create the organization identity in Better Auth (handles members/roles)
  let authOrg;
  try {
    authOrg = await auth.api.createOrganization({
      body: { name, slug },
      headers: fromNodeHeaders(req.headers),
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create organization', detail: err.message });
  }

  // 2. Create domain data record linked to the auth org
  const org = await Organization.create({
    authOrgId: authOrg.id,
    name,
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

// ── PUT /api/organizations/:id ───────────────────────────────────────────────
const updateOrganization = async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) return res.status(404).json({ message: 'Organization not found' });
  if (org.ownerId !== req.user.id) {
    return res.status(403).json({ message: 'Only the owner can update the organization' });
  }

  const { name, description, location, type, logo, isPublic } = req.body;
  if (name?.trim()) org.name = name.trim();
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
  const org = await Organization.findById(req.params.orgId);
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

  res.json({ org: { id: org._id, name: org.name, logo: org.logo, primaryColor: org.primaryColor }, competition, divisions });
};

// ── GET /api/organizations/:orgId/divisions/:divId/public ────────────────────
const getPublicDivision = async (req, res) => {
  const org = await Organization.findById(req.params.orgId);
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

  let matches = [], standings = [], bracket = {};
  if (isTournament) {
    const raw = await populateMatch(
      Match.find({ division: division._id }).sort({ round: 1, bracketPosition: 1 })
    );
    raw.forEach((m) => {
      if (!bracket[m.round]) bracket[m.round] = [];
      bracket[m.round].push(m);
    });
  } else {
    matches = await populateMatch(
      Match.find({ division: division._id }).sort({ round: 1, bracketPosition: 1 })
    );
    standings = await calculateStandings(division._id);
  }

  res.json({
    org: { id: org._id, name: org.name, authOrgId: org.authOrgId, logo: org.logo, primaryColor: org.primaryColor },
    division,
    allDivisions,
    teams,
    matches,
    standings,
    bracket,
  });
};

module.exports = {
  createOrganization,
  getMyOrganizations,
  getOrganization,
  getPublicOrganization,
  getPublicCompetition,
  getPublicDivision,
  updateOrganization,
};
