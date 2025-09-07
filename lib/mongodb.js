// const mongoose = require("mongoose");

// let isConnected = false;

// async function connectDB() {
//   if (isConnected) return;

//   try {
//     await mongoose.connect(process.env.MONGODB_URI);
//     isConnected = true;
//     console.log("✅ Connected to MongoDB");
//   } catch (err) {
//     console.error("❌ MongoDB connection error:", err.message);
//     throw err;
//   }
// }

// module.exports = connectDB;


const mongoose = require("mongoose");

let isConnected = false;
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

async function connectDB(retries = 0) {
  if (isConnected) return;

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    isConnected = true;
    console.log("✅ Connected to MongoDB");
  } catch (err) {
    console.error(`❌ MongoDB connection error: ${err.message}`);

    if (retries < MAX_RETRIES) {
      console.log(`🔁 Retrying connection in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      return connectDB(retries + 1);
    } else {
      console.error("❌ Max retries reached. Could not connect to MongoDB.");
      throw err;
    }
  }
}

// Optional: handle connection errors after initial connection
mongoose.connection.on("error", (err) =>
  console.error("MongoDB runtime error:", err)
);

mongoose.connection.on("disconnected", () =>
  console.warn("⚠️ MongoDB disconnected. Attempting to reconnect...")
);

module.exports = connectDB;
