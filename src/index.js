require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { toNodeHandler } = require('better-auth/node');
const { auth } = require('./lib/auth');

const sportRoutes        = require('./routes/sport.routes');
const competitionRoutes  = require('./routes/competition.routes');
const divisionRoutes     = require('./routes/division.routes');
const teamRoutes         = require('./routes/team.routes');
const matchRoutes        = require('./routes/match.routes');
const standingsRoutes    = require('./routes/standings.routes');
const organizationRoutes = require('./routes/organization.routes');

const app = express();

// CORS must explicitly list the frontend origin when credentials: true
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Better Auth handler — mounts BEFORE express.json() because it manages its own body parsing.
// All /api/auth/* requests are handled entirely by Better Auth.
app.all('/api/auth/*', toNodeHandler(auth));

// JSON body parsing for the rest of the API
app.use(express.json());

app.use('/api/sports',        sportRoutes);
app.use('/api/competitions',  competitionRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api',               divisionRoutes);
app.use('/api',               teamRoutes);
app.use('/api',               matchRoutes);
app.use('/api',               standingsRoutes);

app.use((err, _req, res, _next) => {
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
