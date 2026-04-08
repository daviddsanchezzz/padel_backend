const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema(
  {
    competition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competition',
      required: true,
    },
    // Only set for league matches
    division: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Division',
      default: null,
    },
    teamA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
    },
    teamB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
    },
    // Round number (1 = first round, 2 = second, etc.)
    round: {
      type: Number,
      default: 1,
    },
    // Human-readable round name: 'Final', 'Semifinal', 'Cuartos de final', etc.
    roundName: {
      type: String,
      default: '',
    },
    // Position within the bracket (0-indexed, used to link parent/child matches)
    bracketPosition: {
      type: Number,
      default: null,
    },
    scheduledDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'awaiting_confirmation', 'played', 'cancelled'],
      default: 'pending',
    },
    // Flexible result — format depends on sport scoringType:
    // sets:  { sets: [{a: 6, b: 3}, {a: 7, b: 5}] }
    // goals: { goals: { a: 3, b: 1 } }
    // points: { points: { a: 21, b: 15 } }
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Proposed result waiting for opponent confirmation
    pendingResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Team that proposed the pending result
    proposedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
    },
    winner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Match', matchSchema);
