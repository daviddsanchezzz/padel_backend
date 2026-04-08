const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth.middleware');
const {
  createOrganization,
  getMyOrganizations,
  getOrganization,
  getPublicOrganization,
  updateOrganization,
} = require('../controllers/organization.controller');

// Public — no auth required
router.get('/:id/public', getPublicOrganization);

// All routes below require a valid session
router.use(authenticate);

router.get('/', getMyOrganizations);
router.post('/', createOrganization);
router.get('/:id', getOrganization);
router.put('/:id', updateOrganization);

module.exports = router;
