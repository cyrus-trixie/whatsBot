// index.js - Main Express Server for WhatsApp Webhooks
import express from 'express';
import 'dotenv/config'; // Used to load environment variables from .env

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON payloads (required for Meta webhooks)
app.use(express.json());

// --- Configuration Variables ---
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const API_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const API_URL = `https://graph.facebook.com/v20.0/${PHONE_ID}/messages`;

/**
 * Step 3: Send message using Meta Cloud API
 * @param {string} to - Recipient phone number.
 * @param {string} message - Text message content.
 */
const sendMessage = async (to, message) => {
    if (!API_TOKEN || !PHONE_ID) {
        console.error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID. Cannot send message.");
        return;
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: message },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error(`Failed to send message. HTTP Status: ${response.status}`, errorData);
        } else {
            console.log(`Message successfully sent to ${to}.`);
        }
    } catch (error) {
        console.error("Error during sendMessage API call:", error);
    }
};

/**
 * Step 1 & 2: Handle GET (Verification) and POST (Events) requests.
 * Route: /whatsapp/webhook
 */
app.all('/whatsapp/webhook', async (req, res) => {
    // ----------------------------------------------------
    // 1. WEBHOOK VERIFICATION (HTTP GET REQUEST)
    // ----------------------------------------------------
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        if (mode && token) {
            if (mode === 'subscribe' && token === VERIFY_TOKEN) {
                console.log('Webhook Verified Successfully!');
                // Send the challenge back to Meta
                return res.status(200).send(challenge);
            } else {
                // Tokens do not match or mode is incorrect
                return res.status(403).send('Verification failed');
            }
        }
        // If not a verification request, respond with 403
        return res.status(403).send('Verification failed: Missing parameters');
    }

    // ----------------------------------------------------
    // 2. RECEIVE MESSAGE (HTTP POST REQUEST)
    // ----------------------------------------------------
    if (req.method === 'POST') {
        const data = req.body;
        console.log('Incoming Webhook Data:', JSON.stringify(data, null, 2));

        try {
            // Check for a new message structure
            const messageData = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

            if (messageData) {
                const from = messageData.from; // Sender phone number
                const messageType = messageData.type;
                const textBody = messageType === 'text' ? messageData.text.body : `[${messageType} message]`;

                console.log(`Received message from ${from}: ${textBody}`);

                // Send auto reply
                await sendMessage(from, "Hello, welcome to Immuno. Enter 1 to continue.");
            }

        } catch (error) {
            console.error("Error processing incoming message data:", error);
        }

        // Meta requires a 200 OK response regardless of message processing outcome
        return res.status(200).send('EVENT_RECEIVED');
    }
});

// Start the Express server
app.listen(PORT, () => {
    console.log(`\nWhatsApp Webhook Server running on http://localhost:${PORT}`);
    console.log(`Remember to run ngrok and use your HTTPS forwarding URL!`);
});