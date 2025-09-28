require("dotenv").config();
const express = require("express");
const cors = require("cors");

const yahooRoute = require("./routes/yahoo");

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/yahoo", yahooRoute);  // live fetch

app.get("/", (req, res) => {
  res.send("<h2>🚀 Stock API running</h2>");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
