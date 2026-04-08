require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes        = require('./routes/auth.routes');
const sportRoutes       = require('./routes/sport.routes');
const competitionRoutes = require('./routes/competition.routes');
const divisionRoutes    = require('./routes/division.routes');
const teamRoutes        = require('./routes/team.routes');
const matchRoutes       = require('./routes/match.routes');
const standingsRoutes   = require('./routes/standings.routes');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/api/auth',         authRoutes);
app.use('/api/sports',       sportRoutes);
app.use('/api/competitions', competitionRoutes);
app.use('/api',              divisionRoutes);
app.use('/api',              teamRoutes);
app.use('/api',              matchRoutes);
app.use('/api',              standingsRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(process.env.PORT, () => {
      console.log(`Server running on port ${process.env.PORT}`);
    });
  })
  .catch((err) => { console.error(err); process.exit(1); });
