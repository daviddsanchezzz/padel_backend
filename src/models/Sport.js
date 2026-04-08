mongoose = require('mongoose');

const sportSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // How many players per team side (2 = doubles padel, 1 = singles)
    teamSize: { type: Number, default: 2 },
    // 'sets' | 'goals' | 'points'
    scoringType: { type: String, enum: ['sets', 'goals', 'points'], default: 'sets' },
    // Default competition settings for this sport
    defaultSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        pointsPerWin: 3,
        pointsPerLoss: 0,
        pointsPerDraw: 1,
        setsPerMatch: 3,
        tieBreakers: ['points', 'setDifference', 'setsFor'],
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Sport', sportSchema);
