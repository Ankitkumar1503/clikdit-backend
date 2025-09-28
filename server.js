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

// Routes
app.get("/token", dialer.gettwilotoken);
app.post("/call-status", dialer.callStatus); // For call analytics
app.post("/voice", dialer.twiliovice); // For web clients only

app.get("/test", (req, res) => {
  res.send("Server is working");
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));