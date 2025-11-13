import express from 'express';
import 'dotenv/config';

// Initialize Express app
const app = express();
app.use(express.json());

// --- CONFIGURATION & STATE MANAGEMENT ---
const userState = new Map();

// Environment Variables (Ensure these are set on Render)
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

// NEW: API Base URL and Static Token Variable
const LARAVEL_API_BASE = process.env.LARAVEL_API_BASE;
const LARAVEL_API_TOKEN = process.env.LARAVEL_API_TOKEN;

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
const INTRO_MESSAGE = "Jambo! I'm Immuno, your dedicated Community Health Worker assistant. I'm here to make tracking immunization schedules simple and quick.";
const MAIN_MENU = `
--- Immuno Main Menu ---
Hello, CHW! What would you like to do today?

1. Register New Parent/Guardian (Household)
2. Register New Baby (Child & Schedule)
3. Create Ad-hoc Appointment
4. Modify/Cancel Appointment

Helpful Tip: Type CANCEL at any time to return to this menu.
`;

// --- Helper Functions ---
// --- Helper: Send WhatsApp Message ---
async function sendMessage(to, text) {
    // FIX for (#100) error: Ensure 'text' is not null, undefined, or empty.
    if (!text || text.trim() === '') {
        console.error("Attempted to send an empty message. Skipping.");
        return;
    }

    if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
        console.error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_ID. Cannot send message.");
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
        if (response.ok) { console.log(`[OK] Message sent to ${to}`); } else { console.error("Error sending message:", await response.json()); }
    } catch (err) { console.error("Network error:", err.message); }
}

// --- Helper: Get Base Headers for Laravel API ---
function getLaravelApiHeaders(method) {
    const headers = {
        'Content-Type': 'application/json',
        // --- IMPROVEMENT 1: ADD ACCEPT HEADER ---
        'Accept': 'application/json'
    };
    // Add Authorization header for all protected routes (all but /register)
    if (LARAVEL_API_TOKEN) {
        headers['Authorization'] = `Bearer ${LARAVEL_API_TOKEN}`;
    } else {
        // Log a warning if the token is missing and we're not hitting /register
        if (!method.toLowerCase().includes('register')) {
            console.warn("LARAVEL_API_TOKEN is missing. Protected routes will likely fail with 401.");
        }
    }
    return headers;
}


// --- Helper: Fetch Data from Laravel (GET) ---
async function fetchFromLaravel(endpointPath) {
    if (!LARAVEL_API_BASE) {
        console.error("LARAVEL_API_BASE is not configured. Cannot connect to API.");
        return null;
    }
    // Determine which routes need the token. The /register route is typically unprotected.
    const headers = getLaravelApiHeaders(endpointPath);

    try {
        console.log(`Fetching data from: ${LARAVEL_API_BASE}${endpointPath}`);
        const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, {
            method: 'GET',
            headers: headers, // <<< USING NEW HEADERS
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Laravel GET API error [Status: ${response.status}] for ${endpointPath}: ${errorText}`);
            return null;
        }
        return await response.json();
    } catch (err) {
        console.error("Error connecting to Laravel:", err.message);
        return null;
    }
}

// --- Helper: Save Data to Laravel (POST/PUT/DELETE) ---
async function saveToLaravel(endpointPath, data, method = "POST") {
    if (!LARAVEL_API_BASE) {
        console.error("LARAVEL_API_BASE is not configured. Cannot connect to API.");
        return { success: false, error: "LARAVEL_API_BASE environment variable is missing." };
    }

    // Determine which routes need the token. The /register route is typically unprotected.
    const headers = getLaravelApiHeaders(endpointPath);

    try {
        console.log(`Sending data to Laravel API (${method}): ${endpointPath}`, data);
        const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, {
            method: method, // Use the provided method
            headers: headers, // <<< USING NEW HEADERS
            body: method === "GET" || method === "DELETE" ? null : JSON.stringify(data),
        });

        if (!response.ok) {
            let errorData = await response.text();
            // Return the full error data as a string
            return { success: false, error: errorData };
        } else {
            console.log(`Data processed successfully in Laravel via ${method}!`);
            // Check for empty body on successful delete/update (204 No Content)
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                return { success: true, data: await response.json() };
            }
            return { success: true, data: { message: "Operation successful, no content returned." } };
        }
    } catch (err) {
        console.error("Error connecting to Laravel:", err.message);
        return { success: false, error: err.message };
    }
}

// ----------------------------------------------------------------------
// 🟢 NEW HELPER: Lookup Parent By National ID (The critical change)
// ----------------------------------------------------------------------
/**
 * Looks up a parent by National ID and returns the system's numeric ID (e.g., 25).
 * @param {string} nationalId - The National ID entered by the CHW.
 * @returns {Promise<{numeric_id: number, name: string}|null>}
 */
async function lookupParentByNationalId(nationalId) {
    // 🛠️ ASSUMPTION: The Immuno/Laravel API has a searchable endpoint. 
    // Example: /api/parents/search?national_id=12345678
    const endpointPath = `/api/parents/search?national_id=${nationalId}`;

    try {
        const responseData = await fetchFromLaravel(endpointPath);

        // Check if the search was successful and returned a parent object
        if (responseData && responseData.parent) {
            // Assume the API returns the numeric ID and name inside a 'parent' object
            return {
                // This is the numeric ID the system needs for baby registration
                numeric_id: responseData.parent.id, 
                name: `${responseData.parent.first_name} ${responseData.parent.last_name}`,
            };
        } else if (responseData && responseData.data && responseData.data.length > 0) {
            // Alternate assumption: API returns an array of parents
            const parent = responseData.data[0];
            return {
                numeric_id: parent.id,
                name: `${parent.first_name} ${parent.last_name}`,
            };
        } else {
            // Parent not found or empty response
            return null;
        }
    } catch (error) {
        console.error(`Error during Parent National ID lookup for ${nationalId}:`, error);
        return null;
    }
}


// --- FLOW HANDLER: Register Parent/Guardian (Option 1) ---
// (No major changes here, only minor cleanups/fixes were applied by you previously)
async function handleRegisterParent(senderId, state, incomingText, userInput) {
    let nextStep = state.step + 1;
    let reply = '';
    let isConfirmed = false;
    let result = { success: false };

    // Helper to extract first and last name from a single input
    const nameParts = state.data.official_name ? state.data.official_name.split(' ') : ['Unknown', 'Name'];
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0];

    switch (state.step) {
        case 1: // Collecting Name
            state.data.official_name = incomingText;

            // 🆕 NEW STEP: Collect Gender
            reply = "--- New Parent (2/5) ---\nGot it! Is the Parent/Guardian Male or Female? (Reply with M or F):";
            break;

        case 2: // 🆕 NEW STEP: Collecting Gender (Fixes Integrity Constraint Violation)
            if (userInput === 'm' || userInput === 'male') {
                state.data.gender = "Male";
            } else if (userInput === 'f' || userInput === 'female') {
                state.data.gender = "Female";
            } else {
                reply = "Invalid input. Please reply with M for Male or F for Female:";
                nextStep = 2; // Stay on step 2
                break;
            }
            // Move to the next question
            reply = "--- New Parent (3/5) ---\nGreat! Please enter the Parent's WhatsApp Number (e.g., 2547XXXXXXXX) for future reminders:";
            break;

        case 3: // Collecting WhatsApp Number (Previously step 2)
            // Basic number format validation (Kenya mobile number pattern)
            if (!/^(?:254|\+254|0)?(7|1)\d{8}$/.test(incomingText)) {
                reply = "Invalid phone number format. Please ensure it starts with 2547 or 2541 (e.g., 2547XXXXXXXX):";
                nextStep = 3; // Stay on step 3
                break;
            }
            // Clean number to 254 format for API consistency
            state.data.whatsapp_number = incomingText.replace(/^(0|\+)/, '254');
            reply = "--- New Parent (4/5) ---\nGreat! What is the Nearest Clinic to this household?";
            break;

        case 4: // Collecting Nearest Clinic (Previously step 3)
            state.data.nearest_clinic = incomingText;
            reply = "--- New Parent (5/5) ---\nAnd finally, the **Residence Location** (e.g., estate/village name)?";
            break;

        case 5: // Collecting Residence Location (Previously step 4)
            state.data.residence_location = incomingText;
            reply = `
--- Final Confirmation ---
Please review the details for the new parent:
Name/ID: ${state.data.official_name}
Gender: ${state.data.gender}
WhatsApp: ${state.data.whatsapp_number}
Clinic: ${state.data.nearest_clinic}
Residence: ${state.data.residence_location}

Is this data CORRECT? Reply Y or N. (Reply N to restart this registration)
            `;
            nextStep = 6; // Moved to Step 6 for Y/N input
            break;

        case 6: // Confirmation (Y/N) (Previously step 5)
            if (userInput === 'y') {
                isConfirmed = true;

                // 🔑 CRITICAL FIX: Use a placeholder password that meets the 8-character minimum.
                const TEMP_PASSWORD = 'ImmunoBotPassword123';

                // The full payload with placeholder/default values to satisfy all required API fields
                const registerPayload = {
                    first_name: firstName,
                    last_name: lastName,
                    // Use the phone number to create a unique placeholder email
                    email: `${state.data.whatsapp_number}@immunobot.com`,
                    password: TEMP_PASSWORD,
                    phone_number: state.data.whatsapp_number,

                    // ✅ FIX 1: Use the collected gender to satisfy the CHECK constraint
                    gender: state.data.gender,

                    role: "guardian", // CRITICAL: Sets the user role for the Parent
                    nationality: "Kenyan", // Placeholder
                    national_id: 0, // Placeholder
                    date_of_birth: "2000-01-01T00:00:00Z", // Placeholder
                    address: `${state.data.nearest_clinic}, ${state.data.residence_location}`,
                    // ✅ FIX 2: Added a valid placeholder value for marital_status to pass the SQL CHECK constraint
                    marital_status: "Single", // Placeholder. Use a valid enum value from your DB.
                    next_of_kin: state.data.official_name, // Use self as placeholder
                    next_of_kin_contact: state.data.whatsapp_number, // Use self-contact as placeholder
                    no_of_children: 0,
                    password_confirmation: TEMP_PASSWORD // ⬅️ MUST MATCH
                };

                result = await saveToLaravel('/api/register', registerPayload);

                if (result.success) {
                    // 🛠️ FIX 3: Set reply here before deleting state to prevent (#100)
                    reply = `Success! Parent ${state.data.official_name} is successfully registered via the API. You can now use Option 2 to register their baby/child.\n\n${MAIN_MENU}`;
                } else {
                    // --- IMPROVEMENT 2: FULL ERROR LOGGING & PARSING ---
                    try {
                        const errorData = JSON.parse(result.error);
                        if (errorData.errors) {
                            // Format Laravel validation errors for the user
                            const errorMessages = Object.values(errorData.errors).flat().join('\n');
                            reply = `⚠️ Registration failed! Please correct the following API errors:\n${errorMessages}\n\nType CANCEL to return to the menu.`;
                        } else {
                            // Generic API error (e.g., 500, unhandled 404/401)
                            reply = `Error saving data. Check the logs for details. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                        }
                    } catch (e) {
                        // If API error response is not JSON (e.g., HTML 404 page)
                        reply = `Error saving data. Could not process API response. Check the logs for a non-JSON error. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                    }
                }
                userState.delete(senderId); // End flow (must be *after* setting 'reply')
            } else if (userInput === 'n') {
                reply = "Okay, let's start over! Please enter the Parent/Guardian's Official Name or ID again:";
                nextStep = 1;
                state.data = {}; // Clear collected data
            } else {
                reply = "I didn't quite catch that. Please reply Y to confirm the details or N to restart the registration.";
                nextStep = 6;
            }
            break;
    }

    if (!isConfirmed || (isConfirmed && !result.success)) {
        userState.set(senderId, { ...state, step: nextStep });
        await sendMessage(senderId, reply);
    } else if (isConfirmed && result.success) {
        // 🛠️ FIX 3: Send success message here, as userState is deleted above.
        await sendMessage(senderId, reply);
    }
}


// ----------------------------------------------------------------------
// 🟢 UPDATED FLOW HANDLER: Register New Baby (Option 2)
// Uses National ID instead of Numeric ID for Step 1
// ----------------------------------------------------------------------
async function handleRegisterBaby(senderId, state, incomingText, userInput) {
    let nextStep = state.step + 1;
    let reply = '';
    let isConfirmed = false;
    let result = { success: false };

    switch (state.step) {
        case 1: // Collecting National ID
            const nationalId = incomingText.trim();
            if (!/^\d+$/.test(nationalId) || nationalId.length < 5) {
                reply = "That doesn't look like a valid National ID. Please enter the **Parent/Guardian's National ID** (a number, e.g., 37108924):";
                nextStep = 1; // Stay on Step 1
                break;
            }

            // 🔍 LOOKUP LOGIC
            const parentLookupResult = await lookupParentByNationalId(nationalId);

            if (!parentLookupResult) {
                reply = `
⚠️ Parent Lookup Failed!
A Parent/Guardian with National ID **${nationalId}** was not found in the Immuno system.
Please ask the CHW to:
1. Double-check the ID.
2. If the parent is new, use **Option 1 (Register New Parent/Guardian)** first.

Type CANCEL to return to the main menu.
                `;
                userState.delete(senderId); // End flow
                break;
            }

            // SUCCESS: Parent found. Now we have the required numeric ID.
            state.data.guardian_id = parentLookupResult.numeric_id;
            state.data.guardian_name = parentLookupResult.name;
            state.data.guardian_national_id = nationalId;

            reply = `
✅ Parent Found!
Linking baby to: **${state.data.guardian_name}** (National ID: ${nationalId}).
--- New Baby (2/7) ---
Thank you! Please enter the baby's First Name (or official ID name):
            `;
            nextStep = 2; // Move to Step 2
            break;

        case 2: // Collecting First Name (All steps from here are unchanged from previous version)
            state.data.first_name = incomingText;
            reply = "--- New Baby (3/7) ---\nGot it. Now, please enter the baby's Last Name:";
            break;

        case 3: // Collecting Last Name
            state.data.last_name = incomingText;
            reply = "--- New Baby (4/7) ---\nIs the baby Male or Female? (Reply with M or F):";
            break;

        case 4: // Collecting Gender
            if (userInput === 'm' || userInput === 'male') {
                state.data.gender = "Male";
                reply = "--- New Baby (5/7) ---\nGender set to Male. Please enter the baby's Date of Birth (in YYYY-MM-DD format, e.g., 2025-01-20):";
            } else if (userInput === 'f' || userInput === 'female') {
                state.data.gender = "Female";
                reply = "--- New Baby (5/7) ---\nGender set to Female. Please enter the baby's Date of Birth (in YYYY-MM-DD format, e.g., 2025-01-20):";
            } else {
                reply = "Invalid input. Please reply with M for Male or F for Female:";
                nextStep = 4; // Stay on Step 4
            }
            break;

        case 5: // Collecting Date of Birth
            // Simple date validation: checks if it matches YYYY-MM-DD
            if (/\d{4}-\d{2}-\d{2}/.test(incomingText)) {
                state.data.date_of_birth = incomingText + "T00:00:00Z";
                reply = "--- New Baby (6/7) ---\nDOB confirmed. What is the baby's Nationality? (e.g., Kenyan):";
            } else {
                reply = "Invalid date format. Please enter the Date of Birth exactly in YYYY-MM-DD format (e.g., 2025-01-20):";
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
--- Final Confirmation for Baby ---
Please review the details for the new baby:
Guardian: ${state.data.guardian_name} (ID: ${state.data.guardian_national_id})
Name: ${state.data.first_name} ${state.data.last_name}
Gender: ${state.data.gender}
DOB: ${state.data.date_of_birth.substring(0, 10)}
Nationality: ${state.data.nationality}

Is this data CORRECT? Reply Y or N. (Reply N to restart this registration)
            `;
            nextStep = 7; // Stay on Step 7 for Y/N input
            break;

        case 7: // Confirmation (Y/N)
            if (userInput === 'y') {
                isConfirmed = true;
                // Final payload creation before sending to Laravel
                const babyPayload = {
                    guardian_id: state.data.guardian_id, // This is the numeric ID retrieved in Step 1
                    first_name: state.data.first_name,
                    last_name: state.data.last_name,
                    gender: state.data.gender,
                    date_of_birth: state.data.date_of_birth,
                    nationality: state.data.nationality,
                    immunization_status: state.data.immunization_status,
                    last_vaccine_received: state.data.last_vaccine_received,
                    next_appointment_date: state.data.next_appointment_date,
                    // Note: We deliberately exclude guardian_name/national_id as the API doesn't expect them
                };

                // 🛠️ FIX 4: Changed '/babies' to '/api/babies' to fix the 404 error.
                result = await saveToLaravel('/api/babies', babyPayload);

                if (result.success) {
                    // 🛠️ FIX 3: Set reply here before deleting state to prevent (#100)
                    reply = `Success! Baby ${state.data.first_name} is registered and the immunization schedule will be created on your backend. Thank you for your work!\n\n${MAIN_MENU}`;
                } else {
                    // --- IMPROVEMENT 2: FULL ERROR LOGGING & PARSING ---
                    try {
                        const errorData = JSON.parse(result.error);
                        if (errorData.errors) {
                            const errorMessages = Object.values(errorData.errors).flat().join('\n');
                            reply = `⚠️ Registration failed! Please correct the following API errors:\n${errorMessages}\n\nType CANCEL to return to the menu.`;
                        } else {
                            // Check for common non-validation errors (e.g., Guardian ID not found)
                            const errorMessage = errorData.message || `Error! Check logs and ensure Guardian ID ${state.data.guardian_id} exists.`;
                            reply = `Error! The baby registration failed. Type CANCEL to return to the menu.\nAPI Error: ${errorMessage.slice(0, 150)}...`;
                        }
                    } catch (e) {
                        reply = `Error! Could not process API response. Check the logs for a non-JSON error. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                    }
                }

                userState.delete(senderId); // End flow (must be *after* setting 'reply')
            } else if (userInput === 'n') {
                reply = "Okay, let's start over! Please enter the Guardian's National ID again:";
                nextStep = 1;
                state.data = {}; // Clear collected data
            } else {
                reply = "I didn't quite catch that. Please reply Y to confirm the details or N to restart the registration.";
                nextStep = 7;
            }
            break;
    }

    if (!isConfirmed || (isConfirmed && !result.success)) {
        userState.set(senderId, { ...state, step: nextStep, data: state.data });
        await sendMessage(senderId, reply);
    } else if (isConfirmed && result.success) {
        // 🛠️ FIX 3: Send success message here, as userState is deleted above.
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
                reply = "--- New Appointment (2/4) ---\nGot the Baby ID. What is the Date of the Appointment? (in YYYY-MM-DD format, e.g., 2025-11-20):";
            }
            break;

        case 2: // Collecting Appointment Date
            if (/\d{4}-\d{2}-\d{2}/.test(incomingText)) {
                state.data.appointment_date = incomingText + "T00:00:00Z";
                reply = "--- New Appointment (3/4) ---\nDate confirmed. What is the Purpose of this ad-hoc appointment? (e.g., 'Make up for missed dose', 'Checkup'):";
            } else {
                reply = "Invalid date format. Please enter the Appointment Date exactly in YYYY-MM-DD format (e.g., 2025-11-20):";
                nextStep = 2;
            }
            break;

        case 3: // Collecting Purpose/Notes
            state.data.purpose_notes = incomingText;
            state.data.chw_number = senderId; // The CHW creating the appointment is the senderId

            reply = `
--- Final Appointment Confirmation ---
Please review the details for the new appointment:
Baby ID: ${state.data.baby_id}
Date: ${state.data.appointment_date.substring(0, 10)}
Purpose: ${state.data.purpose_notes}
CHW (Creator): ${state.data.chw_number}

Is this data CORRECT? Reply Y or N. (Reply N to restart)
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

                // 🛠️ FIX 4: Changed '/appointments' to '/api/appointments' to fix the 404 error.
                result = await saveToLaravel('/api/appointments', payload);

                if (result.success) {
                    reply = `Success! An Ad-hoc Appointment for Baby ID ${state.data.baby_id} on ${state.data.appointment_date.substring(0, 10)} is created. The parent will be notified.\n\n${MAIN_MENU}`;
                } else {
                    reply = `Error! Appointment creation failed. Check the logs. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                }

                userState.delete(senderId); // End flow
            } else if (userInput === 'n') {
                reply = "Okay, let's restart the Ad-hoc Appointment process. Please enter the *Baby ID* again:";
                nextStep = 1;
                state.data = {}; // Clear collected data
            } else {
                reply = "I didn't quite catch that. Please reply Y to confirm the details or N to restart the process.";
                nextStep = 4;
            }
            break;
    }

    if (!isConfirmed || (isConfirmed && !result.success)) {
        userState.set(senderId, { ...state, step: nextStep, data: state.data });
        await sendMessage(senderId, reply);
    } else if (isConfirmed && result.success) {
        // 🛠️ FIX 3: Send success message here, as userState is deleted above.
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

            // 🛠️ FIX 4: Included '/api/' prefix
            const appointmentResponse = await fetchFromLaravel(`/api/appointments/${state.data.baby_id}`);

            if (!appointmentResponse || !appointmentResponse.appointments || appointmentResponse.appointments.length === 0) {
                reply = `No active appointments found for Baby ID ${state.data.baby_id}. Type CANCEL to return to the menu.`;
                userState.delete(senderId); // End flow
            } else {
                // Formatting the list of appointments for the CHW to choose from
                const appointmentList = appointmentResponse.appointments.map((appt, index) =>
                    `${index + 1}. Date: ${new Date(appt.appointment_date).toLocaleDateString()} | Type: ${appt.appointment_type} | ID: ${appt.id}`
                ).join('\n');

                reply = `
--- Modify/Cancel Appointment ---
Found the following active appointments for Baby ID ${state.data.baby_id}:
${appointmentList}

Reply with the NUMBER of the appointment you wish to modify or cancel.
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
Selected Appointment ID: ${selectedAppointment.id} on ${new Date(selectedAppointment.appointment_date).toLocaleDateString()}.
What would you like to do?
1. Modify Date/Notes
2. Cancel Appointment
                `;
                userState.set(senderId, { ...state, step: 3, data: state.data });
            } else {
                reply = "Invalid selection. Please reply with the NUMBER (1, 2, 3...) of the appointment you want to manage.";
                userState.set(senderId, { ...state, step: 2 }); // Stay on step 2
            }
            break;

        case 3: // Action: Modify or Cancel
            if (userInput === '1') {
                reply = "You chose to Modify. Please enter the NEW Date (YYYY-MM-DD) and a brief Note (e.g., 2025-12-15, Parent requested later date):";
                userState.set(senderId, { ...state, step: 4 });
            } else if (userInput === '2') {
                reply = `Are you sure you want to CANCEL Appointment ID ${state.data.appointment_id}? Reply YES to confirm cancellation.`;
                userState.set(senderId, { ...state, step: 5 });
            } else {
                reply = "Invalid choice. Reply 1 to Modify or 2 to Cancel:";
                userState.set(senderId, { ...state, step: 3 });
            }
            break;

        case 4: // Execute Modify (PUT)
            // Expecting format: YYYY-MM-DD, Note
            const parts = incomingText.split(',').map(p => p.trim());
            const newDate = parts[0];
            const newNote = parts.slice(1).join(', ') || "Modified by CHW via WhatsApp.";

            if (/\d{4}-\d{2}-\d{2}/.test(newDate)) {
                // 🛠️ FIX 4: Included '/api/' prefix
                let result = await saveToLaravel(`/api/appointments/${state.data.appointment_id}`, {
                    appointment_date: newDate + "T00:00:00Z",
                    notes: newNote,
                    chw_number: senderId // Audit who modified it
                }, "PUT");

                if (result.success) {
                    reply = `Success! Appointment ID ${state.data.appointment_id} modified to ${newDate} with note: "${newNote}".\n\n${MAIN_MENU}`;
                } else {
                    reply = `Error modifying appointment. Check logs. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                }
                userState.delete(senderId);
            } else {
                reply = "Invalid format. Please enter the NEW Date (YYYY-MM-DD) and a brief Note, separated by a comma. (e.g., 2025-12-15, New time confirmed):";
                userState.set(senderId, { ...state, step: 4 });
            }
            break;

        case 5: // Execute Cancel (DELETE)
            if (userInput.toLowerCase() === 'yes') {
                // 🛠️ FIX 4: Included '/api/' prefix
                let result = await saveToLaravel(`/api/appointments/${state.data.appointment_id}`, null, "DELETE");

                if (result.success) {
                    reply = `Success! Appointment ID ${state.data.appointment_id} has been CANCELLED.\n\n${MAIN_MENU}`;
                } else {
                    reply = `Error cancelling appointment. Check logs. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                }
                userState.delete(senderId);
            } else {
                reply = "Cancellation not confirmed. Please reply YES to cancel or CANCEL to return to the main menu.";
                userState.set(senderId, { ...state, step: 5 });
            }
            break;
    }

    // 🛠️ FIX 3: Consolidated sending logic. If the state is deleted (success/end of flow), the condition below is false.
    if (userState.get(senderId)) {
        await sendMessage(senderId, reply);
    }
}


// --- WEBHOOK ENDPOINT (GET) for verification ---
app.get('/whatsapp/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// --- WEBHOOK ENDPOINT (POST) for incoming messages ---
app.post('/whatsapp/webhook', (req, res) => {
    // Acknowledge receipt of the message payload immediately
    res.sendStatus(200);

    const body = req.body;

    // Check for changes (messages) in the payload
    if (body.object === 'whatsapp_business_account' && body.entry) {
        for (const entry of body.entry) {
            for (const change of entry.changes) {
                if (change.field === 'messages' && change.value.messages) {
                    for (const message of change.value.messages) {
                        const senderId = message.from;
                        // Filter for only text messages from authorized CHWs
                        if (message.type === 'text' && AUTHORIZED_CHW_NUMBERS.includes(senderId)) {
                            const incomingText = message.text.body.trim();
                            const userInput = incomingText.toLowerCase();

                            // Retrieve or initialize the user's conversation state
                            let state = userState.get(senderId);

                            // --- Global CANCEL Command ---
                            if (userInput === 'cancel') {
                                if (state) {
                                    userState.delete(senderId);
                                    sendMessage(senderId, `❌ **Flow Cancelled.**\nReturning to the main menu:\n${MAIN_MENU}`);
                                } else {
                                    sendMessage(senderId, `Welcome! You are already at the main menu:\n${MAIN_MENU}`);
                                }
                                return;
                            }

                            // --- INITIAL STATE OR MENU SELECTION ---
                            if (!state) {
                                switch (userInput) {
                                    case '1':
                                        userState.set(senderId, { flow: 'parent', step: 1, data: {} });
                                        sendMessage(senderId, "--- New Parent (1/5) ---\nPlease enter the Parent/Guardian's Official Name or ID (e.g., Jane Doe):");
                                        break;
                                    case '2':
                                        userState.set(senderId, { flow: 'baby', step: 1, data: {} });
                                        // 🟢 The crucial update for Option 2
                                        sendMessage(senderId, "--- New Baby (1/7) ---\nTo link the baby, please enter the **Parent/Guardian's National ID** (e.g., 37108924):");
                                        break;
                                    case '3':
                                        userState.set(senderId, { flow: 'appointment', step: 1, data: {} });
                                        sendMessage(senderId, "--- New Appointment (1/4) ---\nPlease enter the *numeric Baby ID* for the appointment:");
                                        break;
                                    case '4':
                                        userState.set(senderId, { flow: 'modify_cancel', step: 1, data: {} });
                                        sendMessage(senderId, "--- Modify/Cancel Appointment (1/?) ---\nPlease enter the *numeric Baby ID* whose appointments you want to manage:");
                                        break;
                                    default:
                                        sendMessage(senderId, MAIN_MENU);
                                        break;
                                }
                                return; // Stop processing and wait for the next message
                            }

                            // --- CONTINUE FLOW ---
                            switch (state.flow) {
                                case 'parent':
                                    handleRegisterParent(senderId, state, incomingText, userInput);
                                    break;
                                case 'baby':
                                    handleRegisterBaby(senderId, state, incomingText, userInput);
                                    break;
                                case 'appointment':
                                    handleCreateAppointment(senderId, state, incomingText, userInput);
                                    break;
                                case 'modify_cancel':
                                    handleModifyCancelAppointment(senderId, state, incomingText, userInput);
                                    break;
                                default:
                                    // Should not happen, but safe fallback
                                    userState.delete(senderId);
                                    sendMessage(senderId, `Something went wrong. Returning to menu:\n${MAIN_MENU}`);
                                    break;
                            }
                        }
                    }
                }
            }
        }
    }
});

// --- SERVER START ---
app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
    console.log(`WhatsApp Webhook URL: [YOUR_SERVER_URL]/whatsapp/webhook`);
});