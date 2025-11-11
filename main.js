import express from 'express';
import 'dotenv/config';

// Initialize Express app
const app = express();
app.use(express.json()); // Added this line to ensure Express can parse JSON bodies

// --- CONFIGURATION & STATE MANAGEMENT ---
const userState = new Map();

// Environment Variables (Ensure these are set on Render)
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;
// We will use this ENV variable as planned:
const LARAVEL_API_BASE = process.env.LARAVEL_API_BASE; 

// WhatsApp API base URL
const API_BASE_URL = `https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`;

// --- AUTHORIZATION CONSTANT ---
// REMINDER: Replace these with your actual CHW numbers!
const AUTHORIZED_CHW_NUMBERS = [
    "254713182732", // Example CHW 1 (Kenya)
    "254798765432",
    "254742918991",
    "254729054607",
    "254111786050"
     // Example CHW 2 (Kenya)
];

// --- Menu Constants ---
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

// --- Helper Functions ---
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

// --- Helper: Save Data to Laravel (POST) ---
async function saveToLaravel(endpointPath, data) {
    if (!LARAVEL_API_BASE) {
        console.error("❌ LARAVEL_API_BASE is not configured. Cannot connect to API.");
        // Ensure a string error message is returned
        return { success: false, error: "LARAVEL_API_BASE environment variable is missing." }; 
    }
    try {
        console.log(`🟢 Sending data to Laravel API: ${endpointPath}`, data);
        const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, { 
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            let errorData = await response.text();
            // Critical fix: Ensure errorData is a string, then trim/slice for logging
            const logError = errorData.length > 200 ? `${errorData.substring(0, 200)}...` : errorData;
            console.error("❌ Laravel API error:", logError);
            // Return the full error data as a string
            return { success: false, error: errorData }; 
        } else {
            console.log("✅ Data saved successfully in Laravel!");
            return { success: true, data: await response.json() };
        }
    } catch (err) {
        console.error("❌ Error connecting to Laravel:", err.message);
        // Ensure a string error message is returned
        return { success: false, error: err.message };
    }
}


// --- FLOW HANDLER: Register Parent/Guardian (Option 1) ---
async function handleRegisterParent(senderId, state, incomingText, userInput) {
    let nextStep = state.step + 1;
    let reply = '';
    let isConfirmed = false;
    let result = { success: false }; // Initialize result here

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
                result = await saveToLaravel('/guardians', {
                    official_name: state.data.official_name,
                    whatsapp_number: state.data.whatsapp_number,
                    nearest_clinic: state.data.nearest_clinic,
                    residence_location: state.data.residence_location,
                });

                if (result.success) {
                    reply = `✅ Wonderful! Parent *${state.data.official_name}* is successfully registered. You can now use Option 2 to register their baby/child.\n\n${MAIN_MENU}`;
                } else {
                    // FIX APPLIED: Ensure result.error is a string and use safe slicing
                    const errorMessage = String(result.error);
                    const slicedError = errorMessage.slice(0, 100);
                    reply = `❌ Oh dear, there was an error saving the data. Please check the logs and ensure your Laravel API is running and try again, or type CANCEL.\nAPI Error: ${slicedError}...`;
                }
                userState.delete(senderId); // End flow
            } else if (userInput === 'n') {
                reply = "Okay, let's start over! Please enter the *Parent/Guardian's Official Name or ID* again:";
                nextStep = 1;
                state.data = {}; // Clear collected data
            } else {
                reply = "I didn't quite catch that. Please reply *Y* to confirm the details or *N* to restart the registration.";
                nextStep = 5;
            }
            break;
    }

    if (!isConfirmed || (isConfirmed && !result.success)) {
        userState.set(senderId, { ...state, step: nextStep });
        await sendMessage(senderId, reply);
    }
}


// --- FLOW HANDLER: Register New Baby (Option 2) ---
async function handleRegisterBaby(senderId, state, incomingText, userInput) {
    let nextStep = state.step + 1;
    let reply = '';
    let isConfirmed = false;
    let result = { success: false }; // Initialize result here

    switch (state.step) {
        case 1: // Collecting Guardian ID
            state.data.guardian_id = parseInt(incomingText, 10);
            if (isNaN(state.data.guardian_id) || state.data.guardian_id <= 0) {
                reply = "That doesn't look like a valid Guardian ID number. Please enter the *numeric Guardian ID* (e.g., 1, 25, etc.):";
                nextStep = 1; // Stay on Step 1
            } else {
                reply = "--- New Baby (2/7) ---\nThank you! Please enter the baby's *First Name* (or official ID name):";
            }
            break;

        case 2: // Collecting First Name
            state.data.first_name = incomingText;
            reply = "--- New Baby (3/7) ---\nGot it. Now, please enter the baby's *Last Name*:";
            break;

        case 3: // Collecting Last Name
            state.data.last_name = incomingText;
            reply = "--- New Baby (4/7) ---\nIs the baby *Male* or *Female*? (Reply with M or F):";
            break;
            
        case 4: // Collecting Gender
            if (userInput === 'm' || userInput === 'male') {
                state.data.gender = "Male";
                reply = "--- New Baby (5/7) ---\nGender set to Male. Please enter the baby's *Date of Birth* (in YYYY-MM-DD format, e.g., 2025-01-20):";
            } else if (userInput === 'f' || userInput === 'female') {
                state.data.gender = "Female";
                reply = "--- New Baby (5/7) ---\nGender set to Female. Please enter the baby's *Date of Birth* (in YYYY-MM-DD format, e.g., 2025-01-20):";
            } else {
                reply = "Invalid input. Please reply with *M* for Male or *F* for Female:";
                nextStep = 4; // Stay on Step 4
            }
            break;

        case 5: // Collecting Date of Birth
            // Simple date validation: checks if it matches YYYY-MM-DD
            if (/\d{4}-\d{2}-\d{2}/.test(incomingText)) {
                // IMPORTANT: The API needs an ISO-8601 format date string, which YYYY-MM-DD is close to.
                // We will assume the API can handle this or a simple date-time string.
                state.data.date_of_birth = incomingText + "T00:00:00Z"; // Append time part to meet API format
                reply = "--- New Baby (6/7) ---\nDOB confirmed. What is the baby's *Nationality*? (e.g., Kenyan):";
            } else {
                reply = "Invalid date format. Please enter the *Date of Birth* exactly in YYYY-MM-DD format (e.g., 2025-01-20):";
                nextStep = 5; // Stay on Step 5
            }
            break;

        case 6: // Collecting Nationality
            state.data.nationality = incomingText;
            
            // Set initial status values (as requested fields are in the payload)
            state.data.immunization_status = "PENDING_SCHEDULE";
            state.data.last_vaccine_received = "NONE";
            state.data.next_appointment_date = null; // Will be set by the API logic

            reply = `
*--- 📋 Final Confirmation for Baby ---*
Please review the details for the new baby:
*Guardian ID:* ${state.data.guardian_id}
*Name:* ${state.data.first_name} ${state.data.last_name}
*Gender:* ${state.data.gender}
*DOB:* ${state.data.date_of_birth.substring(0, 10)}
*Nationality:* ${state.data.nationality}

*Is this data CORRECT? Reply Y or N.* (Reply N to restart this registration)
            `;
            nextStep = 7; // Stay on Step 7 for Y/N input
            break;

        case 7: // Confirmation (Y/N)
            if (userInput === 'y') {
                isConfirmed = true;
                // --- POST REQUEST TO LARAVEL (Endpoint: /babies) ---
                result = await saveToLaravel('/babies', state.data);

                if (result.success) {
                    reply = `✅ Success! Baby *${state.data.first_name}* is registered and the immunization schedule will be created on your backend. Thank you for your work!\n\n${MAIN_MENU}`;
                } else {
                    // FIX APPLIED: Ensure result.error is a string and use safe slicing
                    const errorMessage = String(result.error);
                    const slicedError = errorMessage.slice(0, 100);
                    reply = `❌ Error! The baby registration failed. Check the logs and ensure your Laravel API is running and that Guardian ID ${state.data.guardian_id} exists. Type CANCEL to return to the menu.\nAPI Error: ${slicedError}...`;
                }
                
                userState.delete(senderId); // End flow
            } else if (userInput === 'n') {
                reply = "Okay, let's start over! Please enter the *Guardian ID* again:";
                nextStep = 1;
                state.data = {}; // Clear collected data
            } else {
                reply = "I didn't quite catch that. Please reply *Y* to confirm the details or *N* to restart the registration.";
                nextStep = 7;
            }
            break;
    }

    if (!isConfirmed || (isConfirmed && !result.success)) {
        userState.set(senderId, { ...state, step: nextStep, data: state.data });
        await sendMessage(senderId, reply);
    }
}


// --- Health Check Route ---
app.get('/', (req, res) => {
    res.send({ status: 'Immuno Bot running', api_base: LARAVEL_API_BASE || 'Not Configured' });
});

// --- Webhook Verification (GET) ---
app.get('/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('[✅] Webhook verified successfully!');
            return res.status(200).send(challenge);
        } else {
            return res.status(403).send('Forbidden: Verification token mismatch.');
        }
    }
    res.status(400).send('Bad Request: Missing hub.mode or hub.token.');
});

// -------------------------------------------------------------------------------------
// --- CORE LOGIC: Handle Incoming WhatsApp Messages (POST) ---
// -------------------------------------------------------------------------------------
app.post('/whatsapp/webhook', async (req, res) => {
    // 1. Always respond immediately
    res.sendStatus(200);

    const body = req.body;
    // Check for nested message structure
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages;

    if (!messages || messages.length === 0) {
        return; // Exit cleanly if not a message
    }

    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`\n--- [${timestamp}] Incoming message payload received ---`);

    for (const message of messages) {
        if (message.type === 'text') {
            const incomingText = message.text.body.trim();
            // Get senderId and strip any non-digit characters to ensure clean matching/storage
            const senderId = message.from.replace(/\D/g, ''); 

            // 0.5. AUTHORIZATION GATE
            if (!AUTHORIZED_CHW_NUMBERS.includes(senderId)) {
                console.warn(`❌ UNAUTHORIZED access attempt from ${senderId}.`);
                await sendMessage(senderId, "Access Denied. This bot is restricted to registered Community Health Workers only.");
                return; 
            }

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
            // 1. HANDLE USER IN AN ACTIVE FLOW (Sequential Prompts)
            // --------------------------------------------------------
            if (state.flow === 'register_parent') {
                await handleRegisterParent(senderId, state, incomingText, userInput);
                return;
            }
            
            if (state.flow === 'register_baby') {
                await handleRegisterBaby(senderId, state, incomingText, userInput);
                return;
            }

            // ... (other flows will go here: create_appointment, modify_appointment) ...


            // --------------------------------------------------------
            // 2. HANDLE MAIN MENU SELECTION (flow: 'menu')
            // --------------------------------------------------------

            if (['1', '2', '3', '4'].includes(userInput)) {
                let nextFlow;
                let firstPrompt = "";

                if (userInput === '1') {
                    nextFlow = 'register_parent';
                    firstPrompt = "--- New Parent Registration (1/4) ---\nHello! Please enter the *Parent/Guardian's Official Name or ID* to start:";
                } else if (userInput === '2') {
                    nextFlow = 'register_baby';
                    firstPrompt = "--- New Baby Registration (1/7) ---\nTo link the baby, please enter the *Guardian ID* (the number from their registration):";
                } else {
                    nextFlow = userInput === '3' ? 'create_appointment' : 'modify_appointment';
                    firstPrompt = `*Immuno Bot:* Starting the *${nextFlow.replace('_', ' ')}* flow. This flow is still under construction! Please use CANCEL.`;
                }
                
                // Set the new state to start the flow (Step 1)
                userState.set(senderId, { flow: nextFlow, step: 1, data: {} });
                
                // IMMEDIATE NEXT STEP: Start the first prompt for the selected flow.
                await sendMessage(senderId, firstPrompt);
                
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

    if (!WA_TOKEN || !verifyToken || !WA_PHONE_NUMBER_ID) {
        console.warn('🚨 WARNING: WHATSAPP_TOKEN, VERIFY_TOKEN, or WHATSAPP_PHONE_ID not set. API/Webhook operations will fail.');
    }
    if (!LARAVEL_API_BASE) {
        console.warn('🚨 WARNING: LARAVEL_API_BASE is NOT set. External API calls will result in an error message.');
    } else {
        console.log(`✅ LARAVEL_API_BASE is set to: ${LARAVEL_API_BASE}`);
    }
});
