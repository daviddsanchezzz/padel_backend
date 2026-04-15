const express = require('express');
const router = express.Router();
const {
  getDivisionTeams, createDivisionTeam,
  getCompetitionTeams, createCompetitionTeam,
  getCompetitionTeamsDetailed,
  updateTeam, deleteTeam, joinTeam,
} = require('../controllers/team.controller');
const { authenticate, requireOrganizer } = require('../middlewares/auth.middleware');

router.use(authenticate);

// League teams (division-scoped)
router.get('/divisions/:divisionId/teams',  getDivisionTeams);
router.post('/divisions/:divisionId/teams', requireOrganizer, createDivisionTeam);

// Tournament teams (competition-scoped, no division)
router.get('/competitions/:competitionId/teams/detailed', requireOrganizer, getCompetitionTeamsDetailed);
router.get('/competitions/:competitionId/teams',  getCompetitionTeams);
router.post('/competitions/:competitionId/teams', requireOrganizer, createCompetitionTeam);

// Shared
router.put('/teams/:id',    requireOrganizer, updateTeam);
router.delete('/teams/:id', requireOrganizer, deleteTeam);
router.post('/teams/:id/join', joinTeam);

module.exports = router;
