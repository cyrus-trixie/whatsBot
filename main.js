
const express = require('express');
const app = express();

// Middleware to parse incoming JSON bodies from webhooks
app.use(express.json());

// --- Configuration ---
// PORT defaults to 3000 if not set in environment (Render often sets its own PORT)
const port = process.env.PORT || 3000;

// The VERIFY_TOKEN must be set as an environment variable on Render
const verifyToken = process.env.VERIFY_TOKEN; 

// --- Health Check Route ---
// A simple route for checking server status at the root URL
app.get('/', (req, res) => {
    res.status(200).send("Server is running. Webhook listener is active on /whatsapp/webhook");
});


// 1. --- Webhook Verification (GET Request) ---
// Use this full URL in the Meta Developer Portal Callback URL field:
// https://whatsbot-7muk.onrender.com/whatsapp/webhook
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
// This is where all the actual message events and status updates are sent.
app.post('/whatsapp/webhook', (req, res) => {
    // ALWAYS respond quickly with a 200 OK to prevent Meta from retrying the notification
    res.status(200).end();

    // Log the incoming payload for inspection (you would process the message here)
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`\n\n--- Webhook received ${timestamp} ---`);
    
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            // This structure indicates a received message (or status update)
            console.log('Received Message Payload:');
            console.log(JSON.stringify(body, null, 2));

            // --- MESSAGE PROCESSING LOGIC GOES HERE ---
            const messageData = body.entry[0].changes[0].value;
            const messages = messageData.messages;

            if (messages) {
                messages.forEach(message => {
                    if (message.type === 'text') {
                        const incomingText = message.text.body;
                        const senderId = message.from;
                        console.log(`\n-> New message from ${senderId}: "${incomingText}"`);
                        // Your reply logic would be called here.
                    }
                });
            }
            
        } else {
            // Log other non-message events
            console.log('Received Non-Message Event Payload (e.g., status updates, capability changes):');
            console.log(JSON.stringify(body, null, 2));
        }
    } else {
        // Log unexpected payloads
        console.log('Received Unexpected Payload:');
        console.log(JSON.stringify(body, null, 2));
    }
});


// --- Start the server ---
app.listen(port, () => {
    console.log(`\nServer is running on port ${port}`);
    console.log(`Webhook endpoint: /whatsapp/webhook`);
    if (!verifyToken) {
        console.warn("\n!!! WARNING: VERIFY_TOKEN is not set in environment variables. Webhook verification will fail. !!!\n");
    }
});