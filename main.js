import express from 'express';
import 'dotenv/config';

// Initialize Express app
const app = express();

// --- STATE MANAGEMENT ---
// Using an in-memory map to store the current state and progress for each CHW (senderId)
const userState = new Map();
const LARAVEL_API_BASE = process.env.LARAVEL_API_BASE;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

// --- Menu Constants ---
const INTRO_MESSAGE = "🇰🇪 Welcome to the Immuno, built for CHWs.";
const MAIN_MENU = `
*--- Main Menu ---*
Please reply with the *number* of the action you wish to perform:

*1.* 👶 Register New Parent/Guardian
*2.* 💉 Register New Baby (Child Data)
*3.* 🗓️ Create Ad-hoc Appointment
*4.* ✏️ Modify/Cancel Appointment
`;

// --- Helper Functions (sendMessage, fetchFromLaravel, saveBabyToLaravel, etc. remain the same) ---
// Note: These are omitted here for brevity but should be kept in your file.
// ... (The helper functions you already have) ...

// --- Helper: Send WhatsApp Message ---
async function sendMessage(to, text) {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    console.error("⚠ Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID. Cannot send message.");
    return;
  }
  const payload = { messaging_product: "whatsapp", recipient_type: "individual", to: to, type: "text", text: { preview_url: false, body: text } };
  try {
    console.log(`\n[SENDING] Replying to ${to}...`);
    const response = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`, {
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

// --- Helper: Save Baby Data to Laravel (POST) ---
async function saveBabyToLaravel(babyData) {
    if (!LARAVEL_API_BASE) {
        console.error("❌ LARAVEL_API_BASE is not configured. Cannot connect to API.");
        return;
    }
  try {
    console.log(`🟢 Sending data to Laravel API:`, babyData);
    const response = await fetch(`${LARAVEL_API_BASE}/babies`, { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
// ----------------------------------------------------------------------


// --- Handle Incoming WhatsApp Messages (POST) ---
app.post('/whatsapp/webhook', async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

  if (messages && messages.length > 0) {
    for (const message of messages) {
      if (message.type === 'text') {
        const incomingText = message.text.body.trim();
        const senderId = message.from;

        console.log(`💬 Message from ${senderId}: "${incomingText}"`);

        // Check user's current state
        const state = userState.get(senderId) || { flow: 'menu', step: 0 };
        const userInput = incomingText.toLowerCase();

        // --------------------------------------------------------
        // 1. HANDLE USER IN AN ACTIVE FLOW (Sequential Prompts)
        // --------------------------------------------------------
        if (state.flow !== 'menu') {
            // Placeholder: The actual flow logic will go here in the next step
            await sendMessage(senderId, `I see you are in the *${state.flow.replace('_', ' ')}* flow (Step ${state.step}). The next steps will be built in the next round! Please reply *CANCEL* to return to the main menu.`);
            if (userInput === 'cancel') {
                userState.delete(senderId);
                await sendMessage(senderId, "Operation cancelled. Returning to the main menu.");
                await sendMessage(senderId, MAIN_MENU);
            }
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
            
            // Set the new state to start the flow
            userState.set(senderId, { flow: nextFlow, step: 1, data: {} });
            
            // For now, we only confirm the flow start.
            await sendMessage(senderId, `*You selected Option ${userInput}.* Starting the ${nextFlow.replace('_', ' ')} flow...`);
            
            // IMMEDIATE NEXT STEP: Start the first prompt for the selected flow.
            if (nextFlow === 'register_parent') {
                await sendMessage(senderId, "Please enter the *Parent/Guardian's Official Name or ID*:");
            }
            
        } else if (userInput === 'babies') {
            // Kept the 'babies' GET command for direct testing/debugging
            const babyResponse = await fetchFromLaravel('/babies');
            // ... (Your working GET logic here) ...
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
  }
});

// --- Start Server ---
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on port ${process.env.PORT || 3000}`);
});