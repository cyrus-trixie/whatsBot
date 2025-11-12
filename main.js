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
    "254111786050",
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
            console.error(`❌ Laravel GET API error [Status: ${response.status}] for ${endpointPath}: ${errorText}`); // Improved error logging
            return null;
        }
        return await response.json();
    } catch (err) {
        console.error("❌ Error connecting to Laravel:", err.message);
        return null;
    }
}

// --- Helper: Save Data to Laravel (POST/PUT/DELETE) ---
async function saveToLaravel(endpointPath, data, method = "POST") {
    if (!LARAVEL_API_BASE) {
        console.error("❌ LARAVEL_API_BASE is not configured. Cannot connect to API.");
        return { success: false, error: "LARAVEL_API_BASE environment variable is missing." }; 
    }
    try {
        console.log(`🟢 Sending data to Laravel API (${method}): ${endpointPath}`, data);
        const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, { 
            method: method, // Use the provided method
            headers: { "Content-Type": "application/json" },
            body: method === "GET" || method === "DELETE" ? null : JSON.stringify(data),
        });

        if (!response.ok) {
            let errorData = await response.text();
            // Critical fix: Ensure errorData is a string, then trim/slice for logging
            const logError = errorData.length > 200 ? `${errorData.substring(0, 200)}...` : errorData;
            console.error(`❌ Laravel API error [Status: ${response.status}]:`, logError); // Improved error logging
            // Return the full error data as a string
            return { success: false, error: errorData }; 
        } else {
            console.log(`✅ Data processed successfully in Laravel via ${method}!`);
            // Check for empty body on successful delete/update (204 No Content)
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                return { success: true, data: await response.json() };
            }
            return { success: true, data: { message: "Operation successful, no content returned." } };
        }
    } catch (err) {
        console.error("❌ Error connecting to Laravel:", err.message);
        return { success: false, error: err.message };
    }
}


// --- FLOW HANDLER: Register Parent/Guardian (Option 1) ---
async function handleRegisterParent(senderId, state, incomingText, userInput) {
    let nextStep = state.step + 1;
    let reply = '';
    let isConfirmed = false;
    let result = { success: false }; 

    switch (state.step) {
        case 1: // Collecting Name
            state.data.official_name = incomingText;
            reply = "--- New Parent (2/4) ---\nGot it! Please enter the *Parent's WhatsApp Number* (e.g., 2547XXXXXXXX) for future reminders:";
            break;
        case 2: // Collecting WhatsApp Number
            // Basic number format validation (Kenya mobile number pattern)
            if (!/^(?:254|\+254|0)?(7|1)\d{8}$/.test(incomingText)) {
                reply = "Invalid phone number format. Please ensure it starts with 2547 or 2541 (e.g., 2547XXXXXXXX):";
                nextStep = 2; // Stay on step 2
                break;
            }
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
                
                // --- CRITICAL FIX: Endpoint changed to /register and keys adjusted ---
                const registerPayload = {
                    // Use WhatsApp number as the main login identifier
                    email_or_phone_number: state.data.whatsapp_number, 
                    // Use the name/ID as the password (as per API docs) for registration
                    password_or_national_id: state.data.official_name, 
                    // Laravel will handle storing these in a related profile/user table
                    official_name: state.data.official_name, 
                    nearest_clinic: state.data.nearest_clinic,
                    residence_location: state.data.residence_location,
                };
                
                result = await saveToLaravel('/register', registerPayload);

                if (result.success) {
                    reply = `✅ Wonderful! Parent *${state.data.official_name}* is successfully registered via the API. You can now use Option 2 to register their baby/child.\n\n${MAIN_MENU}`;
                } else {
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
    let result = { success: false }; 

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
                state.data.date_of_birth = incomingText + "T00:00:00Z"; 
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


// --- FLOW HANDLER: Create Ad-hoc Appointment (Option 3) ---
async function handleCreateAppointment(senderId, state, incomingText, userInput) {
    let nextStep = state.step + 1;
    let reply = '';
    let isConfirmed = false;
    let result = { success: false };

    switch (state.step) {
        case 1: // Collecting Baby ID
            state.data.baby_id = parseInt(incomingText, 10);
            if (isNaN(state.data.baby_id) || state.data.baby_id <= 0) {
                reply = "That doesn't look like a valid Baby ID. Please enter the *numeric Baby ID* for the appointment:";
                nextStep = 1; 
            } else {
                reply = "--- New Appointment (2/4) ---\nGot the Baby ID. What is the *Date of the Appointment*? (in YYYY-MM-DD format, e.g., 2025-11-20):";
            }
            break;

        case 2: // Collecting Appointment Date
            if (/\d{4}-\d{2}-\d{2}/.test(incomingText)) {
                state.data.appointment_date = incomingText + "T00:00:00Z";
                reply = "--- New Appointment (3/4) ---\nDate confirmed. What is the *Purpose* of this ad-hoc appointment? (e.g., 'Make up for missed dose', 'Checkup'):";
            } else {
                reply = "Invalid date format. Please enter the *Appointment Date* exactly in YYYY-MM-DD format (e.g., 2025-11-20):";
                nextStep = 2; 
            }
            break;

        case 3: // Collecting Purpose/Notes
            state.data.purpose_notes = incomingText;
            state.data.chw_number = senderId; // The CHW creating the appointment is the senderId

            reply = `
*--- 📋 Final Appointment Confirmation ---*
Please review the details for the new appointment:
*Baby ID:* ${state.data.baby_id}
*Date:* ${state.data.appointment_date.substring(0, 10)}
*Purpose:* ${state.data.purpose_notes}
*CHW (Creator):* ${state.data.chw_number}

*Is this data CORRECT? Reply Y or N.* (Reply N to restart)
            `;
            nextStep = 4; // Stay on Step 4 for Y/N input
            break;

        case 4: // Confirmation (Y/N)
            if (userInput === 'y') {
                isConfirmed = true;
                // --- POST REQUEST TO LARAVEL (Endpoint: /appointments) ---
                const payload = {
                    baby_id: state.data.baby_id,
                    appointment_date: state.data.appointment_date,
                    appointment_type: 'Ad-hoc', 
                    notes: state.data.purpose_notes,
                    chw_number: state.data.chw_number,
                };
                
                result = await saveToLaravel('/appointments', payload);

                if (result.success) {
                    reply = `✅ Success! An Ad-hoc Appointment for Baby ID ${state.data.baby_id} on ${state.data.appointment_date.substring(0, 10)} is created. The parent will be notified.\n\n${MAIN_MENU}`;
                } else {
                    const errorMessage = String(result.error);
                    const slicedError = errorMessage.slice(0, 100);
                    reply = `❌ Error! Appointment creation failed. Check the logs and ensure your Laravel API is running. Type CANCEL.\nAPI Error: ${slicedError}...`;
                }
                
                userState.delete(senderId); // End flow
            } else if (userInput === 'n') {
                reply = "Okay, let's restart the Ad-hoc Appointment process. Please enter the *Baby ID* again:";
                nextStep = 1;
                state.data = {}; // Clear collected data
            } else {
                reply = "I didn't quite catch that. Please reply *Y* to confirm the details or *N* to restart the process.";
                nextStep = 4;
            }
            break;
    }

    if (!isConfirmed || (isConfirmed && !result.success)) {
        userState.set(senderId, { ...state, step: nextStep, data: state.data });
        await sendMessage(senderId, reply);
    }
}

// --- NEW FLOW HANDLER: Modify/Cancel Appointment (Option 4) ---
async function handleModifyCancelAppointment(senderId, state, incomingText, userInput) {
    let reply = '';
    
    switch (state.step) {
        case 1: // Collecting Baby ID
            state.data.baby_id = parseInt(incomingText, 10);
            if (isNaN(state.data.baby_id) || state.data.baby_id <= 0) {
                reply = "That doesn't look like a valid Baby ID. Please enter the *numeric Baby ID* whose appointments you want to manage:";
                break; // Stay on step 1
            }
            
            // --- Step 2: Fetch Appointments (Placeholder Logic) ---
            const appointmentResponse = await fetchFromLaravel(`/appointments/${state.data.baby_id}`);
            
            if (!appointmentResponse || !appointmentResponse.appointments || appointmentResponse.appointments.length === 0) {
                reply = `⚠️ No active appointments found for Baby ID ${state.data.baby_id}. Type CANCEL to return to the menu.`;
                userState.delete(senderId); // End flow
            } else {
                // Formatting the list of appointments for the CHW to choose from
                const appointmentList = appointmentResponse.appointments.map((appt, index) => 
                    `*${index + 1}.* Date: ${new Date(appt.appointment_date).toLocaleDateString()} | Type: ${appt.appointment_type} | ID: ${appt.id}`
                ).join('\n');

                reply = `
*--- Modify/Cancel Appointment ---*
Found the following active appointments for Baby ID ${state.data.baby_id}:
${appointmentList}

Reply with the *NUMBER* of the appointment you wish to modify or cancel.
                `;
                userState.set(senderId, { 
                    ...state, 
                    step: 2, 
                    data: { ...state.data, appointments: appointmentResponse.appointments } 
                });
            }
            break;
        
        case 2: // Selecting Appointment to Modify/Cancel
            const choiceIndex = parseInt(incomingText, 10) - 1;
            const selectedAppointment = state.data.appointments?.[choiceIndex];

            if (selectedAppointment) {
                state.data.appointment_id = selectedAppointment.id;

                reply = `
*Selected Appointment ID: ${selectedAppointment.id}* on ${new Date(selectedAppointment.appointment_date).toLocaleDateString()}.
What would you like to do?
*1.* Modify Date/Notes
*2.* Cancel Appointment
                `;
                userState.set(senderId, { ...state, step: 3, data: state.data });
            } else {
                reply = "Invalid selection. Please reply with the *NUMBER* (1, 2, 3...) of the appointment you want to manage.";
                userState.set(senderId, { ...state, step: 2 }); // Stay on step 2
            }
            break;

        case 3: // Action: Modify or Cancel
            if (userInput === '1') {
                reply = "You chose to **Modify**. Please enter the *NEW Date* (YYYY-MM-DD) and a brief *Note* (e.g., 2025-12-15, Parent requested later date):";
                userState.set(senderId, { ...state, step: 4 });
            } else if (userInput === '2') {
                reply = `Are you sure you want to **CANCEL** Appointment ID ${state.data.appointment_id}? Reply *YES* to confirm cancellation.`;
                userState.set(senderId, { ...state, step: 5 });
            } else {
                reply = "Invalid choice. Reply *1* to Modify or *2* to Cancel:";
                userState.set(senderId, { ...state, step: 3 });
            }
            break;

        case 4: // Execute Modify (PUT)
            // Expecting format: YYYY-MM-DD, Note
            const parts = incomingText.split(',').map(p => p.trim());
            const newDate = parts[0];
            const newNote = parts.slice(1).join(', ') || "Modified by CHW via WhatsApp.";

            if (/\d{4}-\d{2}-\d{2}/.test(newDate)) {
                // --- PUT REQUEST TO LARAVEL (Endpoint: /appointments/{id}) ---
                result = await saveToLaravel(`/appointments/${state.data.appointment_id}`, { 
                    appointment_date: newDate + "T00:00:00Z",
                    notes: newNote,
                    chw_number: senderId // Audit who modified it
                }, "PUT");

                if (result.success) {
                    reply = `✅ Success! Appointment ID ${state.data.appointment_id} modified to ${newDate} with note: "${newNote}".\n\n${MAIN_MENU}`;
                } else {
                    reply = `❌ Error modifying appointment. Check logs. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 100)}...`;
                }
                userState.delete(senderId);
            } else {
                reply = "Invalid format. Please enter the *NEW Date* (YYYY-MM-DD) and a brief *Note*, separated by a comma. (e.g., 2025-12-15, New time confirmed):";
                userState.set(senderId, { ...state, step: 4 });
            }
            break;
        
        case 5: // Execute Cancel (DELETE)
            if (userInput === 'yes') {
                // --- DELETE REQUEST TO LARAVEL (Endpoint: /appointments/{id}) ---
                // Note: DELETE requests often don't need a body, but we pass null to be safe.
                result = await saveToLaravel(`/appointments/${state.data.appointment_id}`, null, "DELETE"); 

                if (result.success) {
                    reply = `✅ Success! Appointment ID ${state.data.appointment_id} has been **CANCELLED**.\n\n${MAIN_MENU}`;
                } else {
                    reply = `❌ Error cancelling appointment. Check logs. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 100)}...`;
                }
                userState.delete(senderId);
            } else {
                reply = "Cancellation not confirmed. Returning to the action menu. Reply *1* to Modify or *2* to Cancel:";
                userState.set(senderId, { ...state, step: 3 });
            }
            break;
    }

    // Only send reply if the flow has not ended (userState.delete)
    if (userState.has(senderId)) {
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

            if (state.flow === 'create_appointment') {
                await handleCreateAppointment(senderId, state, incomingText, userInput);
                return;
            }

            // ADDED: New flow handler for Option 4
            if (state.flow === 'modify_appointment') {
                await handleModifyCancelAppointment(senderId, state, incomingText, userInput);
                return;
            }


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
                } else if (userInput === '3') { 
                    nextFlow = 'create_appointment';
                    firstPrompt = "--- New Ad-hoc Appointment (1/4) ---\nTo schedule an appointment, please enter the *Baby ID* for the child:";
                } else { // Option 4
                    nextFlow = 'modify_appointment';
                    firstPrompt = "--- Modify/Cancel Appointment (1/5) ---\nPlease enter the *Baby ID* for the child whose appointments you want to manage:";
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
