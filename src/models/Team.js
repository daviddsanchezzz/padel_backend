const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
    },
    /**
     * Player slots for this team.
     * - `name` is always set (display name, required).
     * - `userId` is optional — only set when a registered user claims the slot.
     *
     * Design decision: a single array of objects replaces the previous parallel
     * arrays (playerNames + players) which could get out of sync.
     */
    players: [
      {
        name: { type: String, required: true, trim: true },
        dorsal: { type: Number, default: null }, // Jersey number — optional
        userId: { type: String, default: null }, // Better Auth user ID — optional
      },
    ],
    // Always set — every team belongs to a competition
    competition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competition',
      required: true,
    },
    // Only set for league teams (null for tournament teams)
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Division',
      default: null,
    },
    seasonId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    seasonName: {
      type: String,
      required: true,
      default: 'Temporada 1',
    },
    // Group assignment for group-stage tournaments (e.g. 'A', 'B', 'C')
    group: {
      type: String,
      default: null,
    },
    // Contact email — set when team registers via public form
    contactEmail: {
      type: String,
      default: null,
    },
    // ── Payment ──────────────────────────────────────────────────────────────
    // 'free'    → no fee required, registered directly
    // 'pending' → Stripe Checkout created, awaiting payment
    // 'paid'    → confirmed via webhook (checkout.session.completed)
    // 'failed'  → payment failed or expired
    paymentStatus: {
      type: String,
      enum: ['free', 'pending', 'paid', 'failed'],
      default: 'free',
    },
    stripeCheckoutSessionId: { type: String, default: null },
    stripePaymentIntentId:   { type: String, default: null },
    amountPaid:  { type: Number, default: null }, // in cents
    currency:    { type: String, default: null }, // e.g. 'eur'
  },
  { timestamps: true }
);

module.exports = mongoose.model('Team', teamSchema);
