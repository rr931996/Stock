require("dotenv").config();
const express = require("express");
const cors = require("cors");

const yahooRoute = require("./routes/yahoo");

const app = express();
const corsOptions = {
  origin: 'https://stock-app-6gu.pages.dev',
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
