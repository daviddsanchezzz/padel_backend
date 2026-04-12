const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth.middleware');
const {
  createOrganization,
  getMyOrganizations,
  getOrganization,
  getPublicOrganization,
  getPublicCompetition,
  getPublicDivision,
  updateOrganization,
  registerForCompetition,
} = require('../controllers/organization.controller');

// Public — no auth required
router.get('/:id/public', getPublicOrganization);
router.get('/:orgId/competitions/:compId/public', getPublicCompetition);
router.get('/:orgId/divisions/:divId/public', getPublicDivision);
router.post('/:orgId/competitions/:compId/register', registerForCompetition);

// All routes below require a valid session
router.use(authenticate);

router.get('/', getMyOrganizations);
router.post('/', createOrganization);
router.get('/:id', getOrganization);
router.put('/:id', updateOrganization);

module.exports = router;
