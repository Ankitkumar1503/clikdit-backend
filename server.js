// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Dialer } = require("./controllers/dialerController");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const dialer = new Dialer();

// Routes - ADD THE NEW CALL-EVENTS ENDPOINT
app.get("/token", (req, res) => dialer.gettwilotoken(req, res));
app.post("/call-status", (req, res) => dialer.callStatus(req, res));
app.post("/call-events", (req, res) => dialer.callEvents(req, res)); // ADD THIS LINE
app.get("/twiml/connect", (req, res) => dialer.connectCall(req, res));
app.post("/voice", (req, res) => dialer.twiliovice(req, res));
app.post("/recording-status", (req, res) => dialer.recordingStatus(req, res));

// ... rest of your server code remains the same
app.get("/test", (req, res) => {
  res.send("Server is working");
});

app.post("/test-n8n-exact", async (req, res) => {
  // ... existing test code
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));