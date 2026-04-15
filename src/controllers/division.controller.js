const Division = require('../models/Division');
const Competition = require('../models/Competition');

const getDivisions = async (req, res) => {
  const competition = await Competition.findById(req.params.competitionId);
  if (!competition) return res.status(404).json({ message: 'Competition not found' });
  
  const activeSeason = competition.seasons.find((s) => s.isActive);
  if (!activeSeason) return res.status(404).json({ message: 'No active season' });
  
  const divisions = await Division.find({ competition: req.params.competitionId, seasonId: activeSeason._id })
    .sort({ order: 1, createdAt: 1 });
  res.json(divisions);
};

const getDivision = async (req, res) => {
  const division = await Division.findById(req.params.id)
    .populate({ path: 'competition', select: 'name type settings sport organizer', populate: { path: 'sport', select: 'name scoringType teamSize defaultSettings' } });
  if (!division) return res.status(404).json({ message: 'Division not found' });
  res.json(division);
};

const createDivision = async (req, res) => {
  const { competitionId } = req.params;
  const { name, order, teamSize } = req.body;
  if (!name) return res.status(400).json({ message: 'Division name is required' });

  const competition = await Competition.findOne({ _id: competitionId, organizer: req.user._id });
  if (!competition) return res.status(404).json({ message: 'Competition not found' });
  
  // Get active season name
  const activeSeason = competition.seasons.find((s) => s.isActive);
  if (!activeSeason) return res.status(400).json({ message: 'No active season' });

  // Auto-assign order = next after last existing division
  const lastDiv = await Division.findOne({ competition: competitionId }).sort({ order: -1 });
  const nextOrder = order !== undefined ? order : (lastDiv ? lastDiv.order + 1 : 0);

  const division = await Division.create({
    name,
    competition: competitionId,
    order: nextOrder,
    seasonId: activeSeason._id,
    seasonName: activeSeason.name,
    teamSize: teamSize || null,
  });
  res.status(201).json(division);
};

const updateDivision = async (req, res) => {
  const division = await Division.findById(req.params.id).populate('competition');
  if (!division) return res.status(404).json({ message: 'Division not found' });
  if (division.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  Object.assign(division, req.body);
  await division.save();
  res.json(division);
};

const deleteDivision = async (req, res) => {
  const division = await Division.findById(req.params.id).populate('competition');
  if (!division) return res.status(404).json({ message: 'Division not found' });
  if (division.competition.organizer.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  await division.deleteOne();
  res.json({ message: 'Division deleted' });
};

module.exports = { getDivisions, getDivision, createDivision, updateDivision, deleteDivision };
