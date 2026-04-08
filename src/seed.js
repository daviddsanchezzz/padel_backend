require('dotenv').config();
const mongoose = require('mongoose');
const Sport = require('./models/Sport');

const sports = [
  {
    name: 'Pádel',
    slug: 'padel',
    teamSize: 2,
    scoringType: 'sets',
    defaultSettings: {
      pointsPerWin: 3,
      pointsPerLoss: 0,
      pointsPerDraw: 1,
      setsPerMatch: 3,
      tieBreakers: ['points', 'setDifference', 'setsFor'],
    },
  },
  {
    name: 'Tenis',
    slug: 'tennis',
    teamSize: 1,
    scoringType: 'sets',
    defaultSettings: {
      pointsPerWin: 3,
      pointsPerLoss: 0,
      pointsPerDraw: 1,
      setsPerMatch: 3,
      tieBreakers: ['points', 'setDifference', 'setsFor'],
    },
  },
  {
    name: 'Fútbol',
    slug: 'football',
    teamSize: 11,
    scoringType: 'goals',
    defaultSettings: {
      pointsPerWin: 3,
      pointsPerLoss: 0,
      pointsPerDraw: 1,
      tieBreakers: ['points', 'goalDifference', 'goalsFor'],
    },
  },
];

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  for (const sport of sports) {
    await Sport.findOneAndUpdate({ slug: sport.slug }, sport, { upsert: true, new: true });
    console.log(`Seeded sport: ${sport.name}`);
  }
  console.log('Seed complete');
  process.exit(0);
};

seed().catch((err) => { console.error(err); process.exit(1); });
