const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');
const {
  createOrganization,
  getMyOrganizations,
  getOrganization,
  getPublicOrganization,
  getPublicOrganizationBySlug,
  getPublicCompetition,
  getPublicCompetitionBySlug,
  getPublicDivision,
  getPublicMatchDetail,
  updateOrganization,
  registerForCompetition,
  getAdminOrganizationsOverview,
} = require('../controllers/organization.controller');

// Public — no auth required
router.get('/public/by-slug/:slug', getPublicOrganizationBySlug);
router.get('/public/:orgRef/competitions/by-slug/:compSlug/public', getPublicCompetitionBySlug);
router.get('/:id/public', getPublicOrganization);
router.get('/:orgId/competitions/:compId/public', getPublicCompetition);
router.get('/:orgId/divisions/:divId/public', getPublicDivision);
router.get('/:orgId/matches/:matchId/public', getPublicMatchDetail);
router.post('/:orgId/competitions/:compId/register', registerForCompetition);

// All routes below require a valid session
router.use(authenticate);

router.get('/admin/overview', requireAdmin, getAdminOrganizationsOverview);
router.get('/', getMyOrganizations);
router.post('/', createOrganization);
router.get('/:id', getOrganization);
router.put('/:id', updateOrganization);

module.exports = router;
