import express from 'express';
import 'dotenv/config';

// Initialize Express app
const app = express();

// --- Configuration ---
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

// Laravel API base URL. Using 127.0.0.1:8000 since Laravel is running locally.
const LARAVEL_API_BASE = "  https://ca96a5e619b8.ngrok-free.app/api"; 
// const LARAVEL_API_BASE = "https://lazy-crabs-roll.loca.lt/api"; // Your previous loca.lt URL for reference

// WhatsApp API base URL
const API_BASE_URL = `https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`;

// --- Middleware ---
app.use(express.json());

// --- Helper: Send WhatsApp Message ---
async function sendMessage(to, text) {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    console.error("⚠ Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID. Cannot send message.");
    return;
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "text",
    text: {
      preview_url: false,
      body: text
    }
  };

  try {
    console.log(`\n[SENDING] Replying to ${to}...`);
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log(`[✅] Message sent to ${to}`);
    } else {
      const errorData = await response.json();
      console.error("❌ Error sending message:", errorData);
    }
  } catch (err) {
    console.error("❌ Network error:", err.message);
  }
}

// --- Helper: Fetch Data from Laravel (GET) ---
/**
 * Fetches data from a specified Laravel API endpoint.
 * @param {string} endpointPath - e.g., '/babies' or '/doctors/1'
 * @returns {Promise<object | null>} The JSON data or null on error.
 */
async function fetchFromLaravel(endpointPath) {
    try {
        console.log(`📡 Fetching data from: ${LARAVEL_API_BASE}${endpointPath}`);

        const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                // Authorization headers would go here if required by Laravel Sanctum/Passport
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Laravel GET API error for ${endpointPath}: ${response.status} - ${errorText}`);
            return null;
        }

        const data = await response.json();
        return data;

    } catch (err) {
        console.error("❌ Error connecting to Laravel:", err.message);
        return null;
    }
}

// --- Helper: Save Baby Data to Laravel (POST) ---
async function saveBabyToLaravel(babyData) {
  try {
    console.log(`🟢 Sending data to Laravel API:`, babyData);

    const response = await fetch(`${LARAVEL_API_BASE}/babies`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Add Authorization here later if Sanctum is required
      },
      body: JSON.stringify(babyData),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("❌ Laravel API error:", errorData);
    } else {
      console.log("✅ Baby saved successfully in Laravel!");
    }
  } catch (err) {
    console.error("❌ Error connecting to Laravel:", err.message);
  }
}

// --- Health Check Route ---
app.get('/', (req, res) => {
  res.status(200).send("Server is running. Webhook listener is active on /whatsapp/webhook");
});

// --- Webhook Verification (GET) ---
app.get('/whatsapp/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Webhook verified with Meta!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed.');
    res.sendStatus(403);
  }
});

// --- Handle Incoming WhatsApp Messages (POST) ---
app.post('/whatsapp/webhook', async (req, res) => {
  // Always respond immediately to prevent Meta retries
  res.sendStatus(200);

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n--- [${timestamp}] Incoming webhook received ---`);

  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

    if (messages && messages.length > 0) {
      for (const message of messages) {
        if (message.type === 'text') {
          const incomingText = message.text.body.trim().toLowerCase();
          const senderId = message.from;

          console.log(`💬 Message from ${senderId}: "${incomingText}"`);

            // Check if the user wants to list all babies
            if (incomingText === 'babies') {
                const babyResponse = await fetchFromLaravel('/babies');

                if (babyResponse && babyResponse.data && babyResponse.data.length > 0) {
                    const babyList = babyResponse.data.map(baby => {
                        // Assuming the 'babies' table has 'first_name' and 'date_of_birth'
                        const dob = baby.date_of_birth ? new Date(baby.date_of_birth).toLocaleDateString('en-KE') : 'Unknown';
                        return `👶 ${baby.first_name} (DOB: ${dob}, Status: ${baby.immunization_status || 'N/A'})`;
                    }).join('\n');

                    await sendMessage(senderId, `Found ${babyResponse.data.length} Babies:\n\n${babyList}`);
                } else {
                    await sendMessage(senderId, "✅ No baby records found in the system.");
                }
                
                return; // Stop processing further
            }


          // --- Original Placeholder Logic (now runs if not 'babies') ---
          
          // Example: Save message as a baby name for now
          const babyData = {
            name: incomingText,
            gender: "Female",
            date_of_birth: "2023-11-01",
            guardian_id: 1
          };

          await saveBabyToLaravel(babyData);
          await sendMessage(senderId, `✅ Baby "${incomingText}" saved successfully in the system.`);

        } else {
          console.log(`📩 Non-text message received: ${message.type}`);
        }
      }
    } else {
      console.log("ℹ No messages in this webhook.");
    }
  } else {
    console.log("⚠ Unrecognized webhook payload structure.");
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌍 Webhook endpoint: /whatsapp/webhook`);
  if (!verifyToken) console.warn("⚠ VERIFY_TOKEN not set. Webhook verification may fail.");
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) console.warn("⚠ WhatsApp credentials missing. Replies will fail.");
});