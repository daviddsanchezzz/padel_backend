const express = require('express');
const router = express.Router();
const {
  getDivisionMatches,
  generateLeagueMatches,
  generateTournamentBracket,
  getTournamentBracket,
  generateDivisionBracket,
  getDivisionBracket,
  recordResult,
  confirmResult,
  disputeResult,
  getPlayerMatches,
} = require('../controllers/match.controller');
const { authenticate, requireOrganizer } = require('../middlewares/auth.middleware');

router.use(authenticate);

// League
router.get('/divisions/:divisionId/matches',           getDivisionMatches);
router.post('/divisions/:divisionId/matches/generate', requireOrganizer, generateLeagueMatches);

// Tournament categories (division-level bracket)
router.post('/divisions/:divisionId/bracket/generate', requireOrganizer, generateDivisionBracket);
router.get('/divisions/:divisionId/bracket',           getDivisionBracket);

// Tournament
router.post('/competitions/:competitionId/bracket/generate', requireOrganizer, generateTournamentBracket);
router.get('/competitions/:competitionId/bracket',           getTournamentBracket);

// Shared
router.put('/matches/:id/result',   recordResult);
router.post('/matches/:id/confirm', confirmResult);
router.post('/matches/:id/dispute', disputeResult);
router.get('/player/matches',       getPlayerMatches);

module.exports = router;
