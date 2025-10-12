require("dotenv").config();
const express = require("express");
const cors = require("cors");

const yahooRoute = require("./routes/yahoo");

const app = express();

// Trust the first proxy hop (e.g., from Render's load balancer).
// This is crucial for rate-limiting and getting the correct client IP.
app.set("trust proxy", 1);

const corsOptions = {
  origin: ['https://stock-app-6gu.pages.dev', 'http://localhost:3000'],
  optionsSuccessStatus: 200 // For legacy browser support
};
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use("/api/yahoo", yahooRoute);  // live fetch

app.get("/", (req, res) => {
  res.send("<h2>🚀 Stock API running</h2>");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
