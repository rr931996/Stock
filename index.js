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
connectDB()
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("Cannot start server without DB connection:", err);
    process.exit(1);
  });

// Routes
app.use("/api/yahoo", yahooRoute);  // live fetch
app.use("/api/stocks", stockRoute); // DB fetch + delete

app.get("/", (req, res) => {
  res.send("<h2>🚀 Stock API running</h2>");
});

const PORT = process.env.PORT || 5100;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
