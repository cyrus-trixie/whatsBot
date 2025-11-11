import express from 'express';
import 'dotenv/config';

// Initialize Express app
const app = express();

// --- CONFIGURATION & STATE MANAGEMENT ---
// Using an in-memory map to store the current state and progress for each CHW (senderId)
const userState = new Map();

// Environment Variables (Ensure these are set on Render)
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;
const LARAVEL_API_BASE = process.env.LARAVEL_API_BASE;

// WhatsApp API base URL
const API_BASE_URL = `https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`;

// --- Menu Constants ---
const INTRO_MESSAGE = "🇰🇪 Welcome to the IVY Immunization Tracker, built for CHWs.";
const MAIN_MENU = `
*--- Main Menu ---*
Please reply with the *number* of the action you wish to perform:

*1.* 👶 Register New Parent/Guardian
*2.* 💉 Register New Baby (Child Data)
*3.* 🗓️ Create Ad-hoc Appointment
*4.* ✏️ Modify/Cancel Appointment

*TIP:* Type *CANCEL* at any time to return to this menu.
`;

// --- Middleware ---
app.use(express.json());

// --- Helper: Send WhatsApp Message ---
async function sendMessage(to, text) {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    console.error("⚠ Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID. Cannot send message.");
    return;
  }
  const payload = { messaging_product: "whatsapp", recipient_type: "individual", to: to, type: "text", text: { preview_url: false, body: text } };
  try {
    console.log(`\n[SENDING] Replying to ${to}...`);
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (response.ok) { console.log(`[✅] Message sent to ${to}`); } else { console.error("❌ Error sending message:", await response.json()); }
  } catch (err) { console.error("❌ Network error:", err.message); }
}

// --- Helper: Fetch Data from Laravel (GET) ---
async function fetchFromLaravel(endpointPath) {
    if (!LARAVEL_API_BASE) {
        console.error("❌ LARAVEL_API_BASE is not configured. Cannot connect to API.");
        return null;
    }
    try {
        console.log(`📡 Fetching data from: ${LARAVEL_API_BASE}${endpointPath}`);
        const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Laravel GET API error for ${endpointPath}: ${response.status} - ${errorText}`);
            return null;
        }
        return await response.json();
    } catch (err) {
        console.error("❌ Error connecting to Laravel:", err.message);
        return null;
    }
}

// --- Helper: Save Baby Data to Laravel (POST - Simplified for Demo) ---
async function saveToLaravel(endpointPath, data) {
    if (!LARAVEL_API_BASE) {
        console.error("❌ LARAVEL_API_BASE is not configured. Cannot connect to API.");
        return { success: false };
    }
  try {
    console.log(`🟢 Sending data to Laravel API: ${endpointPath}`, data);
    const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("❌ Laravel API error:", errorData);
      return { success: false, error: errorData };
    } else {
      console.log("✅ Data saved successfully in Laravel!");
      return { success: true, data: await response.json() };
    }
  } catch (err) {
    console.error("❌ Error connecting to Laravel:", err.message);
    return { success: false, error: err.message };
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

// -------------------------------------------------------------------------------------
// --- CORE LOGIC: Handle Incoming WhatsApp Messages (POST) ---
// -------------------------------------------------------------------------------------
app.post('/whatsapp/webhook', async (req, res) => {
  // 1. Always respond immediately
  res.sendStatus(200);

  const body = req.body;

    // 🛡️ ROBUST GUARDRAILS: Safely check for the required messages structure
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

    if (!messages || messages.length === 0) {
        // This is a status update, test ping, or invalid structure. Exit cleanly.
        return;
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`\n--- [${timestamp}] Incoming message payload received ---`);

    for (const message of messages) {
        if (message.type === 'text') {
            const incomingText = message.text.body.trim();
            const senderId = message.from;

            console.log(`💬 Message from ${senderId}: "${incomingText}"`);

            // Get user state or set default 'menu' state
            const state = userState.get(senderId) || { flow: 'menu', step: 0 };
            const userInput = incomingText.toLowerCase();

            // --- 0. CANCEL COMMAND ---
            if (userInput === 'cancel') {
                if (state.flow !== 'menu') {
                    userState.delete(senderId);
                    await sendMessage(senderId, "Operation cancelled. Returning to the main menu.");
                } else {
                    await sendMessage(senderId, "You are already at the main menu.");
                }
                await sendMessage(senderId, MAIN_MENU);
                return;
            }

            // --------------------------------------------------------
            // 1. HANDLE USER IN AN ACTIVE FLOW (Sequential Prompts)
            // --------------------------------------------------------
            if (state.flow !== 'menu') {
                // Placeholder for flow steps (We will build this in the next iteration)
                userState.set(senderId, { ...state, step: state.step + 1 });

                await sendMessage(senderId, 
                    `You are currently in the *${state.flow.replace('_', ' ')}* flow.\n\n` +
                    `You are on *Step ${state.step + 1}*. Your last input was: "${incomingText}".\n\n` + 
                    `_Type CANCEL to exit._`);
                
                return;
            }

            // --------------------------------------------------------
            // 2. HANDLE MAIN MENU SELECTION (flow: 'menu')
            // --------------------------------------------------------

            if (['1', '2', '3', '4'].includes(userInput)) {
                let nextFlow;
                if (userInput === '1') nextFlow = 'register_parent';
                if (userInput === '2') nextFlow = 'register_baby';
                if (userInput === '3') nextFlow = 'create_appointment';
                if (userInput === '4') nextFlow = 'modify_appointment';
                
                // Set the new state to start the flow (Step 1)
                userState.set(senderId, { flow: nextFlow, step: 1, data: {} });
                
                // IMMEDIATE NEXT STEP: Start the first prompt for the selected flow.
                if (nextFlow === 'register_parent') {
                    await sendMessage(senderId, "--- New Parent Registration (1/4) ---\nPlease enter the *Parent/Guardian's Official Name or ID*:");
                } else {
                    await sendMessage(senderId, `*You selected Option ${userInput}.* Starting the ${nextFlow.replace('_', ' ')} flow...`);
                }
                
            } else if (userInput === 'babies') {
                // Kept the 'babies' GET command for direct testing/debugging
                const babyResponse = await fetchFromLaravel('/babies');
                
                if (babyResponse && babyResponse.babies && babyResponse.babies.length > 0) {
                    const babyList = babyResponse.babies.map(baby => {
                        const dob = baby.date_of_birth ? new Date(baby.date_of_birth).toLocaleDateString('en-KE') : 'Unknown';
                        return `👶 ${baby.first_name} (DOB: ${dob}, Status: ${baby.immunization_status || 'N/A'})`;
                    }).join('\n');
                    await sendMessage(senderId, `*API Test Success* Found ${babyResponse.babies.length} Babies:\n\n${babyList}`);
                } else {
                    await sendMessage(senderId, "*API Test Fail:* No baby records found or API error.");
                }
                
            } else {
                // Default response: The Intro and Menu
                await sendMessage(senderId, INTRO_MESSAGE);
                await sendMessage(senderId, MAIN_MENU);
            }
        }
    }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌍 Webhook endpoint: /whatsapp/webhook`);
});