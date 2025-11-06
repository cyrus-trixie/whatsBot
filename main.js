const express = require('express');
const app = express();
// Using native 'fetch' which is available in Node.js 18+.
// If using an older version, install node-fetch (npm install node-fetch) and require it.

// Middleware to parse incoming JSON bodies from webhooks
app.use(express.json());

// --- Configuration (Loaded from Render Environment Variables) ---
const port = process.env.PORT || 3000;

// The VERIFY_TOKEN must match the one set in your Meta App Webhook configuration
const verifyToken = process.env.VERIFY_TOKEN; 

// The WHATSAPP_TOKEN and PHONE_ID are crucial for sending replies
const WA_TOKEN = process.env.WHATSAPP_TOKEN; 
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID; 

// Base URL for sending messages
const API_BASE_URL = `https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`;

// --- Utility Function to Send WhatsApp Messages ---

/**
 * Sends a text message response via the WhatsApp Cloud API.
 * @param {string} to - The recipient's phone number (the sender of the incoming message).
 * @param {string} text - The text content of the reply message.
 */
async function sendMessage(to, text) {
    if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
        console.error("!!! FATAL: WHATSAPP_TOKEN or WHATSAPP_PHONE_ID is not set. Cannot send message. !!!");
        return;
    }

    const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to, // The sender of the incoming message becomes the recipient of the reply
        type: "text",
        text: {
            preview_url: false,
            body: text
        }
    };

    try {
        console.log(`\n[SENDING] Attempting to reply to ${to}...`);
        
        const response = await fetch(API_BASE_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WA_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log(`[REPLY SENT] Successfully echoed message to ${to}.`);
        } else {
            // Log detailed error from Meta API if available
            const errorData = await response.json();
            console.error(`!!! ERROR SENDING MESSAGE to ${to} (${response.status} ${response.statusText}) !!!`);
            console.error("Meta API Response Error:", JSON.stringify(errorData, null, 2));
        }

    } catch (error) {
        console.error("!!! ERROR DURING FETCH OR NETWORK FAILURE !!!");
        console.error(error.message);
    }
}


// --- Health Check Route ---
app.get('/', (req, res) => {
    res.status(200).send("Server is running. Webhook listener is active on /whatsapp/webhook");
});


// 1. --- Webhook Verification (GET Request) ---
app.get('/whatsapp/webhook', (req, res) => {
    // Extract challenge, mode, and token from query parameters
    const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

    // Check if mode is 'subscribe' and the tokens match exactly
    if (mode === 'subscribe' && token === verifyToken) {
        // Respond with the challenge token to complete verification
        console.log('--- WEBHOOK VERIFIED ---');
        res.status(200).send(challenge);
    } else {
        // If tokens don't match or mode is wrong, reject the request
        console.log('!!! WEBHOOK VERIFICATION FAILED !!!');
        res.status(403).end();
    }
});


// 2. --- Handle Incoming Messages (POST Request) ---
app.post('/whatsapp/webhook', (req, res) => {
    // Step 1: ALWAYS respond quickly with a 200 OK to prevent Meta from retrying the notification
    res.status(200).end(); 

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`\n\n--- Webhook received ${timestamp} ---`);
    
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            // This structure indicates a received message
            const messageData = body.entry[0].changes[0].value;
            const messages = messageData.messages;

            if (messages) {
                messages.forEach(message => {
                    // We only process incoming text messages for the echo bot
                    if (message.type === 'text') {
                        const incomingText = message.text.body;
                        const senderId = message.from; // This is your verified phone number

                        // Step 2: Log the incoming message
                        console.log(`\n-> New message from ${senderId}: "${incomingText}"`);

                        // Step 3: Construct and send the echo reply (using the context that you are in Kenya)
                        const replyText = `Hello! You said: "${incomingText}". Your echo bot is working live from Kenya! 🇰🇪`;
                        
                        sendMessage(senderId, replyText);
                    } else {
                         // Handle other message types if necessary
                         console.log(`-> Received non-text message of type: ${message.type}. Not sending echo.`);
                    }
                });
            }
            
        } else {
            // Log other non-message events (e.g., message status updates)
            console.log('Received Non-Message Event Payload (e.g., status updates).');
        }
    } else {
        // Log unexpected payloads
        console.log('Received Unexpected Payload.');
    }
});


// --- Start the server ---
app.listen(port, () => {
    console.log(`\nServer is running on port ${port}`);
    console.log(`Webhook endpoint: /whatsapp/webhook`);
    if (!verifyToken) {
        console.warn("\n!!! WARNING: VERIFY_TOKEN is not set. Webhook verification will fail. !!!\n");
    }
    if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
        console.warn("\n!!! WARNING: WHATSAPP_TOKEN or WHATSAPP_PHONE_ID is not set. Message sending will fail. !!!\n");
    }
});