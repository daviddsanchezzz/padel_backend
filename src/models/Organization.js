const mongoose = require('mongoose');

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
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organization', organizationSchema);
