const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
    },
    // For teams with multiple players, store individual player names in order
    playerNames: [{
      type: String,
      trim: true,
    }],
    // Assigned players in order
    players: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
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
