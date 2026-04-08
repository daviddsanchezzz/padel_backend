const express = require('express');
const router = express.Router();
const { getStandings } = require('../controllers/standings.controller');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);
router.get('/divisions/:divisionId/standings', getStandings);

module.exports = router;
