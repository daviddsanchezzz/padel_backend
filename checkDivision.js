require('dotenv').config();
const mongoose = require('mongoose');
const Division = require('./src/models/Division');
const Competition = require('./src/models/Competition');
const Sport = require('./src/models/Sport');

const checkDivision = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const division = await Division.findById('69d62016fffa70445fd1b681').populate({ path: 'competition', populate: { path: 'sport' } });
  console.log('Division:', JSON.stringify(division, null, 2));
  
  process.exit(0);
};

checkDivision().catch((err) => { console.error(err); process.exit(1); });