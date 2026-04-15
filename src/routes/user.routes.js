const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');

// GET /api/users/admin — list all users (admin only)
router.get('/admin', authenticate, requireAdmin, async (_req, res) => {
  const users = await mongoose.connection.db
    .collection('user')
    .find({})
    .sort({ createdAt: -1 })
    .project({ id: 1, name: 1, email: 1, role: 1, createdAt: 1, emailVerified: 1, image: 1 })
    .toArray();

  res.json({ users });
});

module.exports = router;
