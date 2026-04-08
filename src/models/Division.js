const mongoose = require('mongoose');

const divisionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Division name is required'],
      trim: true,
    },
    competition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Competition',
      required: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    seasonName: {
      type: String,
      required: true,
      default: 'Temporada 1',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Division', divisionSchema);
