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

// --- AUTHORIZATION CONSTANT ---
// REPLACE these placeholders with the actual WhatsApp numbers of the CHWs,
// including the country code but without the leading '+' or spaces.
const AUTHORIZED_CHW_NUMBERS = [
    "254712345678", // Example CHW 1 (Kenya) - REMINDER: Use your real numbers here
    "254798765432", // Example CHW 2 (Kenya) - REMINDER: Use your real numbers here
];

// --- Menu Constants (UPDATED) ---
const INTRO_MESSAGE = "🇰🇪 Jambo! I'm *Immuno*, your dedicated Community Health Worker assistant. I'm here to make tracking immunization schedules simple and quick.";
const MAIN_MENU = `
*--- Immuno Main Menu ---*
Hello, CHW! What would you like to do today?

*1.* 👶 Register New Parent/Guardian (Household)
*2.* 💉 Register New Baby (Child & Schedule)
*3.* 🗓️ Create Ad-hoc Appointment
*4.* ✏️ Modify/Cancel Appointment

*Helpful Tip:* Type *CANCEL* at any time to return to this menu.
`;

// --- Middleware ---
app.use(express.json());

// --- Helper Functions (Omitting for brevity, assume they are correct) ---

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

// --- Helper: Save Data to Laravel (POST - Generalized) ---
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
// ... (Health Check and Webhook Verification remain the same) ...
app.get('/', (req, res) => {
  res.status(200).send("Server is running. Webhook listener is active on /whatsapp/webhook");
});
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
  const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

    if (!messages || messages.length === 0) {
        return; // Exit cleanly if not a message
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`\n--- [${timestamp}] Incoming message payload received ---`);

    for (const message of messages) {
        if (message.type === 'text') {
            const incomingText = message.text.body.trim();
            const senderId = message.from;

            // --------------------------------------------------------
            // 0.5. AUTHORIZATION GATE
            // --------------------------------------------------------
            if (!AUTHORIZED_CHW_NUMBERS.includes(senderId)) {
                console.warn(`❌ UNAUTHORIZED access attempt from ${senderId}.`);
                await sendMessage(senderId, "Access Denied. This bot is restricted to registered Community Health Workers only.");
                return; // Stop processing this message
            }
            // --------------------------------------------------------

            console.log(`💬 Message from ${senderId}: "${incomingText}"`);

            let state = userState.get(senderId) || { flow: 'menu', step: 0, data: {} };
            const userInput = incomingText.toLowerCase();

            // --- 0. CANCEL COMMAND ---
            if (userInput === 'cancel') {
                if (state.flow !== 'menu') {
                    userState.delete(senderId);
                    await sendMessage(senderId, "Operation cancelled. Heading back to the main menu.");
                } else {
                    await sendMessage(senderId, "You are already at the Immuno Main Menu.");
                }
                await sendMessage(senderId, MAIN_MENU);
                return;
            }

            // --------------------------------------------------------
            // 1. HANDLE USER IN THE ACTIVE 'register_parent' FLOW
            // --------------------------------------------------------
            if (state.flow === 'register_parent') {
                let nextStep = state.step + 1;
                let reply = '';
                let isConfirmed = false;

                switch (state.step) {
                    case 1: // Collecting Name
                        state.data.official_name = incomingText;
                        reply = "--- New Parent (2/4) ---\nGot it! Please enter the *Parent's WhatsApp Number* (e.g., 2547XXXXXXXX) for future reminders:";
                        break;
                    case 2: // Collecting WhatsApp Number
                        state.data.whatsapp_number = incomingText;
                        reply = "--- New Parent (3/4) ---\nGreat! What is the *Nearest Clinic* to this household?";
                        break;
                    case 3: // Collecting Nearest Clinic
                        state.data.nearest_clinic = incomingText;
                        reply = "--- New Parent (4/4) ---\nAnd finally, the **Residence Location** (e.g., estate/village name)?";
                        break;
                    case 4: // Collecting Residence Location
                        state.data.residence_location = incomingText;
                        // Build Summary for Step 5
                        reply = `
*--- 📋 Final Confirmation ---*
Please review the details for the new parent:
*Name/ID:* ${state.data.official_name}
*WhatsApp:* ${state.data.whatsapp_number}
*Clinic:* ${state.data.nearest_clinic}
*Residence:* ${state.data.residence_location}

*Is this data CORRECT? Reply Y or N.* (Reply N to restart this registration)
                        `;
                        nextStep = 5; // Stay on Step 5 for Y/N input
                        break;
                    case 5: // Confirmation (Y/N)
                        if (userInput === 'y') {
                            isConfirmed = true;
                            // --- POST REQUEST TO LARAVEL (Endpoint: /guardians) ---
                            const result = await saveToLaravel('/guardians', state.data);

                            if (result.success) {
                                reply = `✅ Wonderful! Parent *${state.data.official_name}* is successfully registered. You can now use Option 2 to register their baby/child.\n\n${MAIN_MENU}`;
                            } else {
                                reply = `❌ Oh dear, there was an error saving the data. Please ensure your Laravel API is running and try again, or type CANCEL.\nAPI Error: ${result.error.slice(0, 50)}...`;
                            }
                            
                            userState.delete(senderId); // End flow
                        } else if (userInput === 'n') {
                            // Restart the flow by going back to step 1
                            reply = "Okay, let's start over! Please enter the *Parent/Guardian's Official Name or ID* again:";
                            nextStep = 1;
                            state.data = {}; // Clear collected data
                            userState.set(senderId, { ...state, step: nextStep, data: state.data });
                        } else {
                            // Invalid confirmation input, stay on step 5
                            reply = "I didn't quite catch that. Please reply *Y* to confirm the details or *N* to restart the registration.";
                            nextStep = 5;
                        }
                        break;
                }

                if (!isConfirmed || (isConfirmed && !result.success)) {
                    // Update state and send next prompt (only if we're mid-flow or failed post-confirmation)
                    userState.set(senderId, { ...state, step: nextStep });
                    await sendMessage(senderId, reply);
                } 
                return; // Stop processing in the active flow

            } else if (state.flow !== 'menu') {
                 // --- Placeholder for other flows (register_baby, create_appointment, etc.) ---
                 // This will run if the flow is not 'menu' or 'register_parent'
                 userState.set(senderId, { ...state, step: state.step + 1 });

                 await sendMessage(senderId, 
                    `You are currently in the *${state.flow.replace('_', ' ')}* flow. We need to build the next steps! \n\n` +
                    `_Type CANCEL to exit._`);
                
                 return;
            }

            // --------------------------------------------------------
            // 2. HANDLE MAIN MENU SELECTION (flow: 'menu') - UPDATED STARTER
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
                    await sendMessage(senderId, "--- New Parent Registration (1/4) ---\nHello! Please enter the *Parent/Guardian's Official Name or ID* to start:");
                } else {
                    await sendMessage(senderId, `*Immuno Bot:* Starting the *${nextFlow.replace('_', ' ')}* flow. Please follow the prompts!`);
                }
                
            } else if (userInput === 'babies') {
                // Kept the 'babies' GET command for direct testing/debugging
                const babyResponse = await fetchFromLaravel('/babies');
                
                if (babyResponse && babyResponse.babies && babyResponse.babies.length > 0) {
                    // ... (list formatting logic remains the same)
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