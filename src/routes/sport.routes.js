const express = require('express');
const router = express.Router();
const Sport = require('../models/Sport');
const { authenticate } = require('../middlewares/auth.middleware');

router.use(authenticate);

router.get('/', async (req, res) => {
  const sports = await Sport.find().sort({ name: 1 });
  res.json(sports);
});

module.exports = router;
