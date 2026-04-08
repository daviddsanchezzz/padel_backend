const express = require('express');
const router = express.Router();
const {
  getCompetitions, getCompetition, getPlayerCompetitions,
  createCompetition, updateCompetition, deleteCompetition,
  getNewSeasonPreview, createNewSeason,
} = require('../controllers/competition.controller');
const { authenticate, requireOrganizer } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/',     getCompetitions);
router.get('/player', getPlayerCompetitions);
router.post('/',    requireOrganizer, createCompetition);
router.get('/:id',  getCompetition);
router.put('/:id',  requireOrganizer, updateCompetition);
router.delete('/:id', requireOrganizer, deleteCompetition);

// New season
router.get('/:id/new-season/preview', requireOrganizer, getNewSeasonPreview);
router.post('/:id/new-season',        requireOrganizer, createNewSeason);

module.exports = router;
