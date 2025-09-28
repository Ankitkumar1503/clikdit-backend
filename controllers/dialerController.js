const twilio = require("twilio");

class Dialer {
  constructor() {
    this.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    this.twilioApiKey = process.env.TWILIO_API_KEY;
    this.twilioApiSecret = process.env.TWILIO_API_SECRET;
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

    if (!this.twilioAccountSid || !this.twilioApiKey || !this.twilioApiSecret) {
      throw new Error("Missing required Twilio environment variables");
    }

    this.AccessToken = twilio.jwt.AccessToken;
    this.VoiceGrant = this.AccessToken.VoiceGrant;
    this.client = twilio(this.twilioAccountSid, this.twilioAuthToken);

    this.gettwilotoken = this.gettwilotoken.bind(this);
  }

  gettwilotoken(req, res, next) {
    try {
      console.log('📞 GET /token received');
      
      const phoneNumber = req.query.phoneNumber;
      console.log('Phone number:', phoneNumber);
      
      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      // Generate unique identity
      const identity = "user_" + Math.floor(Math.random() * 10000);
      console.log(`Generating token for identity: ${identity}`);

      // Create voice grant for mobile app
      const voiceGrant = new this.VoiceGrant({
        outgoingApplicationSid: process.env.TWILIO_APP_SID,
        incomingAllow: false, // Disable incoming if not needed
      });

      // Create access token
      const token = new this.AccessToken(
        this.twilioAccountSid,
        this.twilioApiKey,
        this.twilioApiSecret,
        { identity: identity, ttl: 3600 }
      );

      token.addGrant(voiceGrant);

      res.json({
        token: token.toJwt(),
        identity: identity,
        phoneNumber: phoneNumber
      });
      
    } catch (error) {
      console.error("Error generating token:", error.message);
      res.status(500).json({ error: error.message });
    }
  }

  // Optional: Call status webhook for analytics
  callStatus(req, res, next) {
    try {
      console.log("Call status update:", req.body);
      // Log call events to your database
      res.status(200).send("OK");
    } catch (error) {
      console.error("Error in call status:", error);
      res.status(500).send("Error");
    }
  }

  // Keep this for web clients (your React.js app)
  twiliovice(req, res, next) {
    try {
      console.log("Web client voice request");
      const twiml = new twilio.twiml.VoiceResponse();
      const to = req.body.To;
      
      if (to) {
        twiml.dial({
          callerId: process.env.TWILIO_PHONE_NUMBER
        }, to);
      } else {
        twiml.say("Please provide a phone number to call.");
      }

      res.type("text/xml");
      res.send(twiml.toString());
    } catch (error) {
      console.error("Error in voice handler:", error);
      res.status(500).send("Error");
    }
  }
}

module.exports = { Dialer };