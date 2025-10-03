// controllers/dialerController.js - WITH LIVE STATUS MONITORING
const twilio = require("twilio");

class Dialer {
  constructor() {
    try {
      console.log('🔄 Initializing Dialer with Twilio v5+...');

      this.twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
      this.twilioApiKey = process.env.TWILIO_API_KEY;
      this.twilioApiSecret = process.env.TWILIO_API_SECRET;
      this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
      this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

      if (!this.twilioAccountSid || !this.twilioApiKey || !this.twilioApiSecret || !this.twilioAuthToken) {
        throw new Error("Missing required Twilio environment variables");
      }

      this.client = twilio(this.twilioAccountSid, this.twilioAuthToken);
      this.activeConnections = new Map();
      this.activeMonitors = new Map(); // Track active polling intervals

      console.log('✅ Dialer initialized successfully');
    } catch (error) {
      console.error('❌ Dialer initialization failed:', error.message);
      throw error;
    }
  }

  normalizePhoneNumber(phoneNumber) {
    let cleaned = phoneNumber.replace(/\D/g, '');

    if (cleaned.length === 12 && cleaned.startsWith('91')) {
      return '+' + cleaned;
    }

    if (cleaned.length === 10) {
      return '+91' + cleaned;
    }

    if (phoneNumber.startsWith('+')) {
      return phoneNumber;
    }

    return '+91' + cleaned;
  }

  async gettwilotoken(req, res) {
    try {
      console.log('📞 GET /token received');

      const { phoneNumber, leadName, leadId, company, designation, email, userId } = req.query;

      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
      const identity = "user_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

      console.log(`📱 Phone: ${normalizedPhone}, Identity: ${identity}`);

      const { AccessToken } = twilio.jwt;
      const { VoiceGrant } = AccessToken;

      const voiceGrant = new VoiceGrant({
        outgoingApplicationSid: process.env.TWILIO_APP_SID,
        incomingAllow: true,
      });

      const token = new AccessToken(
        this.twilioAccountSid,
        this.twilioApiKey,
        this.twilioApiSecret,
        { identity: identity, ttl: 3600 }
      );

      token.addGrant(voiceGrant);

      // Store connection info
      this.activeConnections.set(identity, {
        phoneNumber: normalizedPhone,
        leadName: leadName || '',
        leadId: leadId || '',
        company: company || '',
        designation: designation || '',
        email: email || '',
        userId: userId || '',
        timestamp: new Date().toISOString()
      });

      setTimeout(() => this.activeConnections.delete(identity), 10 * 60 * 1000);

      console.log('✅ Token generated and connection stored');

      res.json({
        token: token.toJwt(),
        identity: identity,
        phoneNumber: normalizedPhone,
        accountSid: this.twilioAccountSid
      });

    } catch (error) {
      console.error("❌ Error generating token:", error.message);
      res.status(500).json({ error: error.message });
    }
  }

  // FIXED: Voice handler with proper ringing and live monitoring
  async twiliovice(req, res) {
    try {
      console.log("📱 Voice request from client:", req.body);

      const twiml = new twilio.twiml.VoiceResponse();
      const to = req.body.To;
      const from = req.body.From; // This is the identity

      if (!to) {
        twiml.say("Please provide a phone number to call.");
        res.type("text/xml");
        return res.send(twiml.toString());
      }

      const normalizedTo = this.normalizePhoneNumber(to);
      console.log(`📞 Client ${from} calling ${normalizedTo}`);

      // Get stored connection data
      const connectionData = this.activeConnections.get(from);

      // IMPORTANT: Add ringback tone so user hears proper ringing
      twiml.say({
        voice: 'alice',
        language: 'en-IN'
      }, 'Connecting your call, please wait.');

      // Create the dial with proper settings
      const dial = twiml.dial({
        callerId: this.twilioPhoneNumber,
        timeout: 60, // Increased timeout
        answerOnBridge: true, // Only connect when answered
        ringTone: 'in', // Indian ringing tone
        action: `${process.env.SERVER_URL}/call-status?identity=${from}`,
        method: 'POST',
        record: 'record-from-answer',  // Enable recording
        recordingStatusCallback: `${process.env.SERVER_URL}/recording-status`,
        recordingStatusCallbackMethod: 'POST'
      });

      // Dial the actual phone number with status callbacks
      dial.number({
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallback: `${process.env.SERVER_URL}/call-events?identity=${from}`,
        statusCallbackMethod: 'POST'
      }, normalizedTo);

      console.log('📄 TwiML Response:', twiml.toString());

      res.type("text/xml");
      res.send(twiml.toString());

      // Start monitoring this call
      if (connectionData && process.env.N8N_WEBHOOK_URL) {
        setTimeout(() => {
          this.startCallMonitoring(normalizedTo, from, connectionData);
        }, 2000);
      }

    } catch (error) {
      console.error("❌ Error in voice handler:", error);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say("An error occurred. Please try again.");
      res.type("text/xml");
      res.status(500).send(twiml.toString());
    }
  }

  // NEW: Start live call monitoring with polling
  async startCallMonitoring(phoneNumber, identity, connectionData) {
    try {
      console.log(`🔍 Starting live monitoring for ${phoneNumber}`);

      // Find the call
      await new Promise(resolve => setTimeout(resolve, 3000));

      const calls = await this.client.calls.list({
        to: phoneNumber,
        limit: 5
      });

      const activeCall = calls.find(c =>
        c.status === 'in-progress' ||
        c.status === 'ringing' ||
        c.status === 'queued'
      );

      if (!activeCall) {
        console.log('⚠️ No active call found to monitor');
        return;
      }

      const callSid = activeCall.sid;
      console.log(`🎯 Found call to monitor: ${callSid}`);

      // Send initial status to n8n
      await this.sendStatusToN8n({
        event: 'call_initiated',
        callSid: callSid,
        status: activeCall.status,
        phoneNumber: phoneNumber,
        identity: identity,
        ...connectionData
      });

      // Start polling every 2 seconds
      let pollCount = 0;
      const maxPolls = 150; // Monitor for max 5 minutes (150 * 2 seconds)

      const monitorInterval = setInterval(async () => {
        try {
          pollCount++;

          // Fetch current call status
          const call = await this.client.calls(callSid).fetch();

          console.log(`📊 Poll ${pollCount}: ${callSid} - Status: ${call.status}, Duration: ${call.duration || 0}s`);

          // Send status update to n8n
          await this.sendStatusToN8n({
            event: 'call_status_update',
            callSid: callSid,
            status: call.status,
            duration: call.duration || 0,
            startTime: call.startTime,
            endTime: call.endTime,
            price: call.price,
            priceUnit: call.priceUnit,
            direction: call.direction,
            answeredBy: call.answeredBy,
            phoneNumber: phoneNumber,
            identity: identity,
            pollCount: pollCount,
            ...connectionData
          });

          // Stop monitoring if call is completed or failed
          if (call.status === 'completed' ||
            call.status === 'failed' ||
            call.status === 'busy' ||
            call.status === 'no-answer' ||
            call.status === 'canceled') {

            console.log(`✅ Call ended: ${call.status}, Duration: ${call.duration}s`);

            // Send final status
            await this.sendStatusToN8n({
              event: 'call_completed',
              callSid: callSid,
              finalStatus: call.status,
              totalDuration: call.duration || 0,
              endTime: call.endTime,
              price: call.price,
              priceUnit: call.priceUnit,
              phoneNumber: phoneNumber,
              identity: identity,
              ...connectionData
            });

            clearInterval(monitorInterval);
            this.activeMonitors.delete(callSid);
          }

          // Stop after max polls
          if (pollCount >= maxPolls) {
            console.log('⏰ Max monitoring time reached');
            clearInterval(monitorInterval);
            this.activeMonitors.delete(callSid);
          }

        } catch (error) {
          console.error('❌ Error in monitoring poll:', error.message);
        }
      }, 2000); // Poll every 2 seconds

      // Store the interval so we can clear it if needed
      this.activeMonitors.set(callSid, monitorInterval);

      // Cleanup after 10 minutes
      setTimeout(() => {
        if (this.activeMonitors.has(callSid)) {
          clearInterval(monitorInterval);
          this.activeMonitors.delete(callSid);
          console.log('🧹 Cleaned up stale monitor');
        }
      }, 10 * 60 * 1000);

    } catch (error) {
      console.error('❌ Error starting call monitoring:', error.message);
    }
  }

  // NEW: Handle real-time webhook events from Twilio
  async callEvents(req, res) {
    try {
      console.log('📡 Real-time call event:', req.body);

      const {
        CallSid,
        CallStatus,
        To,
        From,
        Direction,
        Duration,
        Timestamp,
        CallDuration,
        RecordingUrl,
        RecordingSid
      } = req.body;

      const identity = req.query.identity;

      // Acknowledge immediately
      res.status(200).send('OK');

      console.log(`📞 ${Direction} call ${CallSid}: ${CallStatus}`);

      // Get connection data
      const connectionData = identity ? this.activeConnections.get(identity) : null;

      // Send webhook event to n8n
      await this.sendStatusToN8n({
        event: 'webhook_event',
        eventType: CallStatus,
        callSid: CallSid,
        status: CallStatus,
        to: To,
        from: From,
        direction: Direction,
        duration: Duration || CallDuration || 0,
        timestamp: Timestamp,
        recordingUrl: RecordingUrl,
        recordingSid: RecordingSid,
        identity: identity,
        ...connectionData
      });

      // If call completed via webhook, stop monitoring
      if (CallStatus === 'completed' && this.activeMonitors.has(CallSid)) {
        clearInterval(this.activeMonitors.get(CallSid));
        this.activeMonitors.delete(CallSid);
        console.log('🛑 Stopped monitoring - call completed via webhook');
      }

    } catch (error) {
      console.error('❌ Error processing call event:', error);
    }
  }

  // Unified method to send status to n8n
  async sendStatusToN8n(data) {
    try {
      if (!process.env.N8N_WEBHOOK_URL) {
        return;
      }

      const payload = {
        timestamp: new Date().toISOString(),
        accountSid: this.twilioAccountSid,
        ...data
      };

      // Don't log full payload every time (too verbose)
      if (data.event !== 'call_status_update') {
        console.log(`🚀 Sending to n8n: ${data.event}`, {
          callSid: data.callSid,
          status: data.status
        });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(process.env.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Twilio-Call-System/2.0'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok && data.event !== 'call_status_update') {
        console.log(`⚠️ n8n returned status: ${response.status}`);
      }

    } catch (error) {
      // Only log non-update errors to reduce noise
      if (data.event !== 'call_status_update') {
        console.error('❌ n8n error:', error.message);
      }
    }
  }

  // Simple connect endpoint
  async connectCall(req, res) {
    try {
      const identity = req.query.identity;
      console.log(`🔗 Connect request for: ${identity}`);

      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say({
        voice: 'alice',
        language: 'en-IN'
      }, "Connecting your call.");

      res.type('text/xml');
      res.send(twiml.toString());

    } catch (error) {
      console.error('❌ Error in connectCall:', error);
      res.status(500).send('Error');
    }
  }

  recordingStatus(req, res) {
    try {
      console.log("🎙️ Recording status:", req.body);
      const { RecordingSid, RecordingUrl, CallSid, RecordingStatus, RecordingDuration } = req.body;

      if (RecordingStatus === 'completed' && RecordingUrl) {
        console.log(`✅ Recording completed: ${RecordingSid}`);
        console.log(`📼 Recording URL: ${RecordingUrl}`);
        console.log(`⏱️ Duration: ${RecordingDuration}s`);
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("Error in recording status:", error);
      res.status(500).send("Error");
    }
  }

  // Call status handler
  callStatus(req, res) {
    try {
      console.log("📊 Dial status:", req.body);
      const { DialCallStatus, DialCallDuration, CallSid, DialCallSid } = req.body;
      const identity = req.query.identity;

      console.log(`Dial result - Status: ${DialCallStatus}, Duration: ${DialCallDuration}s`);

      // Send dial result to n8n
      if (process.env.N8N_WEBHOOK_URL) {
        const connectionData = identity ? this.activeConnections.get(identity) : null;

          this.sendStatusToN8n({
          event: 'call_completed',
          callSid: callSid,
          finalStatus: call.status,
          totalDuration: call.duration || 0,
          phoneNumber: phoneNumber,
          identity: identity,
          
          // ADD THESE from connectionData
          leadName: connectionData.leadName || '',
          leadId: connectionData.leadId || '',
          company: connectionData.company || '',
          designation: connectionData.designation || '',
          email: connectionData.email || '',
          userId: connectionData.userId || ''
        });
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("Error in call status:", error);
      res.status(500).send("Error");
    }
  }

  // API endpoint to manually get call status
  async getCallStatus(req, res) {
    try {
      const { callSid } = req.params;

      if (!callSid) {
        return res.status(400).json({ error: 'Call SID required' });
      }

      console.log(`🔍 Fetching status for: ${callSid}`);

      const call = await this.client.calls(callSid).fetch();

      const statusData = {
        callSid: call.sid,
        status: call.status,
        duration: call.duration,
        startTime: call.startTime,
        endTime: call.endTime,
        from: call.from,
        to: call.to,
        price: call.price,
        priceUnit: call.priceUnit,
        direction: call.direction,
        answeredBy: call.answeredBy
      };

      console.log('✅ Call status:', statusData);

      res.json(statusData);

    } catch (error) {
      console.error('❌ Error fetching call status:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

}

module.exports = { Dialer };