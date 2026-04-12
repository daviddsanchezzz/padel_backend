const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth.middleware');
const { onboardConnect, connectStatus } = require('../controllers/connect.controller');

router.use(authenticate);

router.post('/onboard', onboardConnect);
router.get('/status',   connectStatus);

module.exports = router;
