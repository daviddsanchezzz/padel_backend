const mongoose = require('mongoose');

const competitionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Competition name is required'],
      trim: true,
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
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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

module.exports = mongoose.model('Competition', competitionSchema);
