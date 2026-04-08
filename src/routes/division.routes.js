const express = require('express');
const router = express.Router();
const { getDivisions, getDivision, createDivision, updateDivision, deleteDivision } = require('../controllers/division.controller');
const { authenticate, requireOrganizer } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/competitions/:competitionId/divisions', getDivisions);
router.post('/competitions/:competitionId/divisions', requireOrganizer, createDivision);
router.get('/divisions/:id', getDivision);
router.put('/divisions/:id', requireOrganizer, updateDivision);
router.delete('/divisions/:id', requireOrganizer, deleteDivision);

module.exports = router;
