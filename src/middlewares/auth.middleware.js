const { fromNodeHeaders } = require('better-auth/node');
const { auth } = require('../lib/auth');

/**
 * Populates req.user and req.session from the Better Auth session cookie/token.
 * Exposes both `id` (BA string) and `_id` (alias) so existing controllers don't break.
 */
const authenticate = async (req, res, next) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) return res.status(401).json({ message: 'Unauthorized' });

    // Alias _id → id so existing code using req.user._id keeps working.
    // Both are the same string — Mongoose auto-casts strings to ObjectId when querying.
    req.user = { ...session.user, _id: session.user.id };
    req.session = session.session;
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

/**
 * Global role check — requires user.role === 'organizer'.
 * Use requireOrgRole for organization-scoped permission checks instead.
 */
const requireOrganizer = (req, res, next) => {
  if (req.user?.role !== 'organizer') {
    return res.status(403).json({ message: 'Organizer access required' });
  }
  next();
};

/**
 * Organization-scoped role check.
 * Reads organizationId from req.params or req.body.
 * roles: array of Better Auth org roles, e.g. ['owner', 'admin']
 */
const requireOrgRole = (roles) => async (req, res, next) => {
  const organizationId = req.params.organizationId || req.body.organizationId;
  if (!organizationId) {
    return res.status(400).json({ message: 'organizationId is required' });
  }

  try {
    const mongoose = require('mongoose');
    const member = await mongoose.connection.db
      .collection('member')
      .findOne({ organizationId, userId: req.user.id });

    if (!member || !roles.includes(member.role)) {
      return res.status(403).json({ message: 'Insufficient organization permissions' });
    }

    req.orgMember = member;
    next();
  } catch {
    return res.status(500).json({ message: 'Authorization check failed' });
  }
};

module.exports = { authenticate, requireOrganizer, requireOrgRole };
