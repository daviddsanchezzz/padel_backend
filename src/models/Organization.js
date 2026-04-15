const mongoose = require('mongoose');

const normalizeOrgName = (value = '') =>
  String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Domain model for organization (club/entity) data.
 *
 * Better Auth's organization plugin manages identity concerns:
 *   - membership list
 *   - roles per member (owner, admin, member)
 *   - invitations
 *
 * This model stores business/domain data that Better Auth doesn't know about.
 * The link between both is `authOrgId` ↔ Better Auth's organization.id.
 */
const organizationSchema = new mongoose.Schema(
  {
    // Better Auth organization ID (nanoid string) — primary foreign key to auth system
    authOrgId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    location: {
      city: { type: String, trim: true },
      country: { type: String, trim: true },
      address: { type: String, trim: true },
    },
    logo: {
      type: String, // URL
    },
    primaryColor: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ['club', 'organizer', 'federation'],
      default: 'club',
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    // Better Auth user ID of the creator/owner
    ownerId: {
      type: String,
      required: true,
    },
    // Sports explicitly disabled for this org. Empty = all sports enabled (default).
    disabledSports: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Sport' }],
    // ── Stripe ───────────────────────────────────────────────────────────────
    // Customer ID for billing model #1 (SaaS subscription to the organizer)
    stripeCustomerId: { type: String, default: null },
    // Connect account ID — null until the org onboards to Stripe Connect.
    stripeAccountId: { type: String, default: null },
    // true once Stripe confirms charges_enabled on the connected account.
    // Updated by the account.updated webhook — no live Stripe API call needed elsewhere.
    stripeConnectActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

organizationSchema.pre('validate', function setNormalizedName(next) {
  if (this.name) {
    this.normalizedName = normalizeOrgName(this.name);
  }
  next();
});

module.exports = mongoose.model('Organization', organizationSchema);
