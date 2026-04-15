const mongoose = require('mongoose');

const toSlug = (value = '') =>
  String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'competicion';

const competitionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Competition name is required'],
      trim: true,
    },
    publicSlug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['league', 'tournament'],
      required: true,
    },
    sport: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sport',
      required: true,
    },
    // Better Auth user ID (string) of the competition creator
    organizer: {
      type: String,
      required: true,
    },
    // Better Auth organization ID — optional, links competition to a club/entity
    organization: {
      type: String,
      default: null,
    },
    seasons: [
      {
        name: {
          type: String,
          required: true,
        },
        isActive: {
          type: Boolean,
          default: false,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    description: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
      maxlength: 140,
      default: '',
    },
    startDate: {
      type: String,
      default: '',
    },
    endDate: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'finished'],
      default: 'draft',
    },
    // Flexible settings — validated against sport defaults at creation
    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

competitionSchema.pre('validate', function setPublicSlug(next) {
  if (!this.publicSlug && this.name) {
    this.publicSlug = toSlug(this.name);
  }
  next();
});

module.exports = mongoose.model('Competition', competitionSchema);
