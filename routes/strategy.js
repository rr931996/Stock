const express = require("express");
const router = express.Router();

// Database server URL
const DATABASE_SERVER_URL = process.env.DATABASE_SERVER_URL || "http://localhost:3001";

// --- Helper Functions ---
const sendErrorResponse = (res, statusCode, message, error) => {
  console.error(`Error: ${message}`, error);
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  res.status(statusCode).json({ message, error: errorMessage });
};

// Proxy request to database server
const proxyRequest = async (method, endpoint, body = null) => {
  try {
    const options = {
      method,
      headers: { "Content-Type": "application/json" }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${DATABASE_SERVER_URL}/api/strategy${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`Database server error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Proxy error calling ${endpoint}:`, error);
    throw error;
  }
};

// Get All Strategies - Proxy to database
router.get("/", async (req, res) => {
  try {
    const result = await proxyRequest("GET", "");
    res.status(200).json(result);
  } catch (error) {
    sendErrorResponse(res, 500, "Failed to retrieve strategies", error);
  }
});

// Save Strategy - Proxy to database
router.post("/save", async (req, res) => {
  try {
    const result = await proxyRequest("POST", "/save", req.body);
    res.status(201).json(result);
  } catch (error) {
    sendErrorResponse(res, 500, "Failed to save strategy", error);
  }
});

// Get Strategy by ID - Proxy to database
router.get("/:id", async (req, res) => {
  try {
    const result = await proxyRequest("GET", `/${req.params.id}`);
    res.status(200).json(result);
  } catch (error) {
    sendErrorResponse(res, 500, "Failed to retrieve strategy", error);
  }
});

// Update Strategy - Proxy to database
router.put("/:id", async (req, res) => {
  try {
    const result = await proxyRequest("PUT", `/${req.params.id}`, req.body);
    res.status(200).json(result);
  } catch (error) {
    sendErrorResponse(res, 500, "Failed to update strategy", error);
  }
});

// Delete Strategy - Proxy to database
router.delete("/:id", async (req, res) => {
  try {
    const result = await proxyRequest("DELETE", `/${req.params.id}`);
    res.status(200).json(result);
  } catch (error) {
    sendErrorResponse(res, 500, "Failed to delete strategy", error);
  }
});

module.exports = router;
