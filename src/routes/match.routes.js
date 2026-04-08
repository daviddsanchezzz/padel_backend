const express = require('express');
const router = express.Router();
const {
  getDivisionMatches,
  getMatchById,
  generateLeagueMatches,
  generateTournamentBracket,
  getTournamentBracket,
  generateDivisionBracket,
  getDivisionBracket,
  recordResult,
  getMatchEvents,
  recordMatchEvents,
  getCompetitionPlayerStats,
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
router.get('/matches/:id',          getMatchById);
router.put('/matches/:id/result',   recordResult);
router.get('/matches/:id/events',   getMatchEvents);
router.put('/matches/:id/events',   recordMatchEvents);
router.post('/matches/:id/confirm', confirmResult);
router.post('/matches/:id/dispute', disputeResult);
router.get('/player/matches',       getPlayerMatches);
router.get('/competitions/:competitionId/player-stats', getCompetitionPlayerStats);

module.exports = router;
