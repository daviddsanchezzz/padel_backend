require('dotenv').config();
const mongoose = require('mongoose');
const Competition = require('./src/models/Competition');
const Sport = require('./src/models/Sport');

const updateCompetitionSport = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const padel = await Sport.findOne({ slug: 'padel' });
  if (!padel) {
    console.log('Padel sport not found');
    return;
  }
  
  // Update all competitions to padel
  const result = await Competition.updateMany({}, { sport: padel._id });
  console.log(`Updated ${result.modifiedCount} competitions to padel`);
  
  process.exit(0);
};

updateCompetitionSport().catch((err) => { console.error(err); process.exit(1); });