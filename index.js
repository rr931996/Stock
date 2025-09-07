require("dotenv").config();
const express = require("express");
const cors = require("cors");

const connectDB = require("./lib/mongodb");
const yahooRoute = require("./routes/yahoo");
const stockRoute = require("./routes/stocks");

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB().then(() => console.log("✅ MongoDB connected"));

// Routes
app.use("/api/yahoo", yahooRoute);  // live fetch
app.use("/api/stocks", stockRoute); // DB fetch

app.get("/", (req, res) => {
  res.send("<h2>🚀 Stock API running</h2>");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
