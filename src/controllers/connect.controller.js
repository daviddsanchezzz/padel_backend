const stripe = require('../services/stripe');
const Organization = require('../models/Organization');

// ── POST /api/connect/onboard ─────────────────────────────────────────────────
// Creates (or re-uses) a Stripe Express account for the org and returns the
// onboarding URL. The org owner is sent to Stripe to connect their bank account.
const onboardConnect = async (req, res) => {
  if (!stripe) return res.status(503).json({ message: 'Payments not configured' });

  const { orgId } = req.body;
  if (!orgId) return res.status(400).json({ message: 'orgId required' });

  const org = await Organization.findById(orgId);
  if (!org) return res.status(404).json({ message: 'Organization not found' });

  // Verify the requester owns this org
  if (org.ownerId !== req.user.id) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  // Create Stripe Express account if not yet linked
  let accountId = org.stripeAccountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { organizationId: org._id.toString(), orgName: org.name },
    });
    accountId = account.id;
    org.stripeAccountId = accountId;
    await org.save();
  }

  const frontendUrl = process.env.FRONTEND_URL?.split(',')[0]?.trim() || 'http://localhost:5173';
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${frontendUrl}/connect/refresh?org_id=${org._id}`,
    return_url:  `${frontendUrl}/connect/return?org_id=${org._id}`,
    type: 'account_onboarding',
  });

  res.json({ url: link.url });
};

// ── GET /api/connect/status?orgId=xxx ─────────────────────────────────────────
// Returns the Stripe Connect onboarding status for the org.
// status: 'not_connected' | 'pending' | 'active'
const connectStatus = async (req, res) => {
  if (!stripe) return res.status(503).json({ message: 'Payments not configured' });

  const { orgId } = req.query;
  if (!orgId) return res.status(400).json({ message: 'orgId required' });

  const org = await Organization.findById(orgId);
  if (!org) return res.status(404).json({ message: 'Organization not found' });

  if (org.ownerId !== req.user.id) {
    return res.status(403).json({ message: 'Forbidden' });
  }

  if (!org.stripeAccountId) {
    return res.json({ status: 'not_connected' });
  }

  try {
    const account = await stripe.accounts.retrieve(org.stripeAccountId);
    const status = account.charges_enabled ? 'active' : 'pending';
    return res.json({ status, accountId: org.stripeAccountId });
  } catch {
    return res.json({ status: 'error' });
  }
};

module.exports = { onboardConnect, connectStatus };
