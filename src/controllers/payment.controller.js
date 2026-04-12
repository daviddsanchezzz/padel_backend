const stripe      = require('../services/stripe');
const Team        = require('../models/Team');
const Organization = require('../models/Organization');
const Competition = require('../models/Competition');

// ── POST /api/payments/checkout ───────────────────────────────────────────────
// Creates a Stripe Checkout session for a pending team registration.
// The teamId is passed by the client after registerForCompetition returns
// requiresPayment:true. Amount is always re-read server-side — never trusted
// from the client.
const createCheckoutSession = async (req, res) => {
  if (!stripe) return res.status(503).json({ message: 'Payments not configured' });

  const { teamId } = req.body;
  if (!teamId) return res.status(400).json({ message: 'teamId required' });

  const team = await Team.findById(teamId);
  if (!team) return res.status(404).json({ message: 'Team not found' });

  // Guard: only create a session if the team is still pending
  if (team.paymentStatus === 'paid') {
    return res.status(409).json({ message: 'Esta inscripción ya está pagada' });
  }
  if (team.paymentStatus === 'free') {
    return res.status(400).json({ message: 'Esta inscripción no requiere pago' });
  }

  // Re-fetch the registration fee from the competition (server-side, never trust client)
  const competition = await Competition.findById(team.competition);
  if (!competition) return res.status(404).json({ message: 'Competition not found' });

  const registrationFee = competition.settings?.registrationFee;
  if (!registrationFee || registrationFee <= 0) {
    // Fee was removed after team was created — mark as free
    team.paymentStatus = 'free';
    await team.save();
    return res.status(400).json({ message: 'Esta inscripción no requiere pago' });
  }

  const org = await Organization.findOne({ authOrgId: competition.organization });
  const frontendUrl = process.env.FRONTEND_URL?.split(',')[0]?.trim() || 'http://localhost:5173';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(registrationFee * 100), // convert to cents
          product_data: {
            name: `Inscripción · ${competition.name}`,
            description: team.name,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: team.contactEmail || undefined,
    success_url: `${frontendUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${frontendUrl}/payment/cancel?team_id=${team._id}`,
    metadata: {
      teamId:         team._id.toString(),
      competitionId:  competition._id.toString(),
      divisionId:     team.division?.toString() || '',
      organizationId: org?._id?.toString() || '',
      // stripeAccountId: org?.stripeAccountId || '' ← add here when Connect is ready
    },
  });

  // Persist session ID so the webhook can find the team
  team.stripeCheckoutSessionId = session.id;
  await team.save();

  res.json({ checkoutUrl: session.url });
};

// ── POST /api/payments/webhook ────────────────────────────────────────────────
// Stripe sends signed events here. Body MUST be raw (not JSON-parsed) so the
// signature verification works. Mounted before express.json() in index.js.
const handleWebhook = async (req, res) => {
  if (!stripe) return res.status(503).send('Payments not configured');

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const team = await Team.findOne({ stripeCheckoutSessionId: session.id });
    if (!team) {
      console.error('[stripe webhook] team not found for session', session.id);
      return res.json({ received: true }); // still 200 so Stripe doesn't retry
    }

    team.paymentStatus          = 'paid';
    team.stripePaymentIntentId  = session.payment_intent || null;
    team.amountPaid             = session.amount_total || null; // in cents
    team.currency               = session.currency || null;
    await team.save();

    console.log(`[stripe] Payment confirmed for team ${team._id} (${team.name})`);
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const team = await Team.findOne({ stripeCheckoutSessionId: session.id });
    if (team && team.paymentStatus === 'pending') {
      team.paymentStatus = 'failed';
      await team.save();
    }
  }

  // Stripe Connect — sync stripeConnectActive when an Express account is updated
  if (event.type === 'account.updated') {
    const account = event.data.object;
    const org = await Organization.findOne({ stripeAccountId: account.id });
    if (org) {
      const isActive = !!account.charges_enabled;
      if (org.stripeConnectActive !== isActive) {
        org.stripeConnectActive = isActive;
        await org.save();
        console.log(`[stripe connect] org ${org._id} stripeConnectActive → ${isActive}`);
      }
    }
  }

  res.json({ received: true });
};

// ── GET /api/payments/status?session_id=xxx ────────────────────────────────────
// Called by the success page to confirm payment status without trusting the redirect.
const getPaymentStatus = async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ message: 'session_id required' });

  const team = await Team.findOne({ stripeCheckoutSessionId: session_id });
  if (!team) return res.status(404).json({ message: 'Not found' });

  res.json({ paymentStatus: team.paymentStatus, teamName: team.name });
};

module.exports = { createCheckoutSession, handleWebhook, getPaymentStatus };
