/**
 * WhatsApp Cloud API Webhook Listener & Echo Bot
 * This server uses Express.js to listen for webhooks and axios to send replies.
 */
const express = require('express');
const axios = require('axios'); // <-- NEW: Import axios for API calls

const app = express();
app.use(express.json());

// --- Configuration (IMPORTANT: Set these as environment variables on Render) ---
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN; 

// The Phone Number ID and Access Token must be set on Render
const waPhoneNumberId = process.env.WHATSAPP_PHONE_ID; 
const accessToken = process.env.ACCESS_TOKEN;
const API_URL = `https://graph.facebook.com/v20.0/${waPhoneNumberId}/messages`; // Use the latest stable version

// --- Send Message Function ---
/**
 * Sends a text message back to a specific WhatsApp number.
 * @param {string} to - The WhatsApp number to send the message to (e.g., '2547xxxxxx').
 * @param {string} text - The message body.
 */
async function sendMessage(to, text) {
    try {
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'text',
            text: {
                // The WhatsApp API allows free-form text when replying within a 24-hour window
                body: text 
            }
        };

        await axios.post(API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                // Authorization header uses the permanent or temporary access token
                'Authorization': `Bearer ${accessToken}`
            }
        });

        console.log(`[REPLY SENT] to ${to}: "${text}"`);

    } catch (error) {
        console.error('!!! ERROR sending message:', error.response ? error.response.data : error.message);
    }
}


// 1. --- Webhook Verification (GET Request) ---
app.get('/whatsapp/webhook', (req, res) => {
    // ... (Verification logic remains the same)
    const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

    if (mode === 'subscribe' && token === verifyToken) {
        console.log('--- WEBHOOK VERIFIED ---');
        res.status(200).send(challenge);
    } else {
        console.log('!!! WEBHOOK VERIFICATION FAILED !!!');
        res.status(403).end();
    }
});


// 2. --- Handle Incoming Messages (POST Request) ---
app.post('/whatsapp/webhook', (req, res) => {
    // ALWAYS respond quickly with a 200 OK
    res.status(200).end(); 

    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
            const messageData = body.entry[0].changes[0].value;
            const messages = messageData.messages;

            if (messages) {
                messages.forEach(message => {
                    if (message.type === 'text') {
                        const incomingText = message.text.body;
                        const senderId = message.from; // This is the user's phone number

                        console.log(`\n-> New message from ${senderId}: "${incomingText}"`);

                        // --- ECHO BOT LOGIC ---
                        // 1. Get sender ID (which is the recipient for the reply)
                        // 2. Determine the reply text (simple echo + Kenyan context)
                        let replyText = `Hello! You sent: "${incomingText}". I'm running live on Render in Kenya!`;

                        // 3. Call the sendMessage function to reply
                        sendMessage(senderId, replyText); 
                    }
                });
            }
        }
    }
});


// --- Start the server ---
app.listen(port, () => {
    console.log(`\nServer is running on port ${port}`);
    if (!waPhoneNumberId || !accessToken) {
         console.warn("\n!!! WARNING: WA_PHONE_NUMBER_ID or ACCESS_TOKEN is missing. Sending messages will fail. !!!\n");
    }
});