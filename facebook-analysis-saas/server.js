// Express server setup and endpoints for sentiment analysis and authentication go here
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    maxOutputTokens: 8192,
    temperature: 0.3,
  },
});

// In-memory user store (no database)
const users = {};

// In-memory store for password reset tokens
const resetTokens = {};

// Middleware
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.static("public"));

// Helper: Hash a password using SHA-256
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// Sign-up endpoint
app.post("/signup", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });
  if (users[email])
    return res.status(400).json({ error: "User already exists" });

  const hashedPassword = hashPassword(password);
  users[email] = { hashedPassword };
  return res.json({ message: "User registered successfully" });
});

// Login endpoint
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const user = users[email];
  if (!user || user.hashedPassword !== hashPassword(password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  // Generate JWT token
  const token = jwt.sign({ email }, process.env.JWT_SECRET, {
    expiresIn: "2h",
  });
  return res.json({ token });
});

// Forgot Password Endpoint
app.post("/forgot-password", (req, res) => {
  const { email } = req.body;
  if (!email || !users[email]) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  const token = crypto.randomBytes(20).toString("hex");
  resetTokens[token] = { email, expires: Date.now() + 3600000 }; // 1-hour expiry

  const resetLink = `http://localhost:3000/reset-password.html?token=${token}`;
  console.log(`Password reset link: ${resetLink}`); // Simulate email

  res.json({ message: "Password reset link sent to your email" });
});

// Reset Password Endpoint
app.post("/reset-password", (req, res) => {
  const { token, newPassword } = req.body;
  const resetData = resetTokens[token];

  if (!resetData || resetData.expires < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  const { email } = resetData;
  users[email].hashedPassword = hashPassword(newPassword);
  delete resetTokens[token];

  res.json({ message: "Password reset successfully" });
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).send("Access Denied");

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).send("Invalid Token");
    req.user = user;
    next();
  });
}

// Serve index.html only if authenticated
app.get("/index", authenticateToken, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("Server is running.");
});

// Facebook Comments Extraction & Sentiment Analysis
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "facebook-scraper-api4.p.rapidapi.com";
const MAX_COMMENTS = 75;

class FacebookCommentExtractor {
  constructor(apiKey) {
    this.baseUrl = `https://${RAPIDAPI_HOST}/get_facebook_post_comments_details`;
    this.headers = {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": RAPIDAPI_HOST,
    };
  }

  async _makeRequest(params) {
    try {
      const response = await axios.get(this.baseUrl, {
        headers: this.headers,
        params,
      });
      return response.data;
    } catch (error) {
      console.error("Request error:", error.message);
      return null;
    }
  }

  async extractComments(postUrl, maxComments = MAX_COMMENTS, delay = 700) {
    let comments = [];
    let endCursor = null;
    let hasNextPage = true;

    while (hasNextPage && comments.length < maxComments) {
      const params = { link: postUrl };
      if (endCursor) params.end_cursor = endCursor;

      const data = await this._makeRequest(params);
      if (!data) break;

      try {
        const batchComments = data.data.comments
          .filter((c) => c.comment_text)
          .map((c) => c.comment_text);

        comments = [...comments, ...batchComments];
        const pageInfo = data.data.page_info || {};
        endCursor = pageInfo.end_cursor;
        hasNextPage = pageInfo.has_next || false;

        console.log(
          `Fetched ${batchComments.length} comments (Total: ${comments.length})`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        console.error("Error processing response:", error);
        break;
      }
    }

    return comments.slice(0, maxComments);
  }
}

async function predictSentiment(texts) {
  try {
    const prompt = {
      contents: [
        {
          parts: [
            {
              text: `Analyze sentiment of these Facebook comments. Use ONLY these labels:
- Very Negative
- Negative
- Neutral
- Positive
- Very Positive

Comments:
${texts.join("\n")}

Respond with a JSON array of labels:`,
            },
          ],
        },
      ],
    };

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.candidates[0].content.parts[0].text;
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const validSentiments = new Set([
      "Very Negative",
      "Negative",
      "Neutral",
      "Positive",
      "Very Positive",
    ]);
    return parsed.map((s) => (validSentiments.has(s) ? s : "Neutral"));
  } catch (error) {
    console.error("Gemini analysis error:", error);
    return Array(texts.length).fill("Neutral");
  }
}

function generateRecommendations(sentimentCounts) {
  const recommendations = [];
  const total = Object.values(sentimentCounts).reduce((a, b) => a + b, 0);
  const percentage = (sentiment) =>
    (((sentimentCounts[sentiment] || 0) / total) * 100).toFixed(1);

  // Advanced Metrics
  const positivityRatio =
    sentimentCounts["Positive"] + sentimentCounts["Very Positive"] >
    sentimentCounts["Negative"] + sentimentCounts["Very Negative"]
      ? "Positive"
      : "Negative";
  const nps =
    ((sentimentCounts["Very Positive"] - sentimentCounts["Very Negative"]) /
      total) *
    100;

  // Tiered Recommendations
  if (percentage("Very Negative") > 20) {
    recommendations.push({
      priority: "Critical",
      message:
        "Critical negative feedback detected. Immediate action required.",
    });
  }
  if (percentage("Negative") > 30) {
    recommendations.push({
      priority: "High",
      message: "Significant negative sentiment. Consider customer outreach.",
    });
  }
  if (percentage("Neutral") > 50) {
    recommendations.push({
      priority: "Medium",
      message:
        "Neutral comments dominant. Boost engagement with interactive content.",
    });
  }
  if (percentage("Positive") > 40) {
    recommendations.push({
      priority: "Low",
      message: "Strong positive sentiment. Leverage for marketing campaigns.",
    });
  }

  // Business-Specific Insights
  if (positivityRatio === "Positive") {
    recommendations.push({
      priority: "Low",
      message:
        "Positive sentiment outweighs negative. Consider expanding marketing efforts.",
    });
  } else {
    recommendations.push({
      priority: "High",
      message:
        "Negative sentiment outweighs positive. Focus on customer retention strategies.",
    });
  }

  if (nps < 0) {
    recommendations.push({
      priority: "Critical",
      message:
        "Net Promoter Score (NPS) is negative. Immediate quality control measures needed.",
    });
  } else if (nps > 50) {
    recommendations.push({
      priority: "Low",
      message:
        "High NPS detected. Leverage customer satisfaction for market expansion.",
    });
  }

  return {
    summary: `Sentiment analysis indicates a ${positivityRatio} trend with an NPS of ${nps.toFixed(
      1
    )}.`,
    recommendations,
  };
}

app.post("/analyze", authenticateToken, async (req, res) => {
  try {
    const { facebook_link } = req.body;
    if (!facebook_link) {
      return res.status(400).json({ error: "Facebook link required" });
    }
    const extractor = new FacebookCommentExtractor(RAPIDAPI_KEY);
    const comments = await extractor.extractComments(facebook_link);
    if (!comments.length) {
      return res.status(400).json({ error: "No comments retrieved" });
    }
    const sentiments = await predictSentiment(comments);
    const sentimentCounts = {
      "Very Negative": sentiments.filter((s) => s === "Very Negative").length,
      Negative: sentiments.filter((s) => s === "Negative").length,
      Neutral: sentiments.filter((s) => s === "Neutral").length,
      Positive: sentiments.filter((s) => s === "Positive").length,
      "Very Positive": sentiments.filter((s) => s === "Very Positive").length,
    };
    const detailedResults = comments.map((text, index) => ({
      text,
      sentiment: sentiments[index] || "Neutral",
    }));
    const { summary, recommendations } =
      generateRecommendations(sentimentCounts);
    res.json({
      summary,
      sentiments: sentimentCounts,
      details: detailedResults,
      recommendations: recommendations.map((rec) => ({
        priority: rec.priority,
        message: rec.message,
      })), // Ensure proper serialization
    });
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "Analysis failed - please try again" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app; // Export the app for Vercel
