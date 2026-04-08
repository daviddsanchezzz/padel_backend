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
    seasonName: {
      type: String,
      required: true,
      default: 'Temporada 1',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Team', teamSchema);
