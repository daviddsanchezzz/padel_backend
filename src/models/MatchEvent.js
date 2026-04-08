const mongoose = require('mongoose');

const matchEventSchema = new mongoose.Schema(
  {
    competition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competition',
      required: true,
      index: true,
    },
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['goal', 'assist', 'yellow_card', 'red_card'],
      required: true,
      index: true,
    },
    minute: {
      type: Number,
      required: true,
      min: 0,
      max: 130,
    },
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true,
    },
    playerName: {
      type: String,
      required: true,
      trim: true,
    },
    playerSlot: {
      type: Number,
      default: null,
      min: 0,
    },
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

matchEventSchema.index({ match: 1, order: 1, minute: 1, createdAt: 1 });
matchEventSchema.index({ competition: 1, type: 1, playerName: 1 });

module.exports = mongoose.model('MatchEvent', matchEventSchema);
