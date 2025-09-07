const mongoose = require("mongoose");

const stockSchema = new mongoose.Schema({
  symbol: String,
  date: Date,
  high: Number,
  low: Number,
});

module.exports = mongoose.models.Stock || mongoose.model("Stock", stockSchema);
