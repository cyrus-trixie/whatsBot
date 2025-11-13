import express from 'express';
import 'dotenv/config';

// Initialize Express app
const app = express();
app.use(express.json());

// --- CONFIGURATION & STATE MANAGEMENT ---
// Stores the conversation state for each user (senderId -> { step, flow, data })
const userState = new Map();

// Environment Variables (Ensure these are set on Render)
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

// API Base URL and Static Token Variable
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
function getLaravelApiHeaders(endpointPath) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json' 
    };
    // Add Authorization header unless we are hitting an unprotected route like /register
    // NOTE: If your /register is protected, remove the check below.
    if (LARAVEL_API_TOKEN) {
        headers['Authorization'] = `Bearer ${LARAVEL_API_TOKEN}`;
    } else if (!endpointPath.toLowerCase().includes('register')) {
         console.warn("LARAVEL_API_TOKEN is missing. Protected routes will likely fail with 401.");
    }
    return headers;
}


// --- Helper: Fetch Data from Laravel (GET) ---
async function fetchFromLaravel(endpointPath) {
    if (!LARAVEL_API_BASE) {
        console.error("LARAVEL_API_BASE is not configured. Cannot connect to API.");
        return null;
    }
    const headers = getLaravelApiHeaders(endpointPath);

    try {
        console.log(`Fetching data from: ${LARAVEL_API_BASE}${endpointPath}`);
        const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, {
            method: 'GET',
            headers: headers,
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
    
    const headers = getLaravelApiHeaders(endpointPath);
    
    try {
        console.log(`Sending data to Laravel API (${method}): ${endpointPath}`, data);
        const response = await fetch(`${LARAVEL_API_BASE}${endpointPath}`, { 
            method: method,
            headers: headers,
            body: method === "GET" || method === "DELETE" ? null : JSON.stringify(data),
        });

        if (!response.ok) {
            let errorData = await response.text();
            return { success: false, error: errorData }; 
        } else {
            console.log(`Data processed successfully in Laravel via ${method}!`);
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

// --- Helper: Get Guardian Database ID using National ID (REQUIRED for Option 2) ---
async function getGuardianIdByNationalId(nationalId) {
    // ⚠️ IMPORTANT: You MUST implement this endpoint in Laravel: /api/guardians/national_id/{nationalId}
    const apiResponse = await fetchFromLaravel(`/api/guardians/national_id/${nationalId}`);
    // Assuming the API returns a response like: { id: 123, ... } or null if not found
    return apiResponse?.id || null; 
}


// --- FLOW HANDLER: Register Parent/Guardian (Option 1) ---
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
            
            // ✅ CHANGE 1: Removed 'or ID'
            reply = "--- New Parent (2/6) ---\nThank you! Please enter the Parent/Guardian's **National ID Number** (e.g., 12345678):";
            break;
            
        case 2: // 🆕 NEW STEP: Collecting National ID
            const nationalId = parseInt(incomingText, 10);
            if (isNaN(nationalId) || nationalId <= 0 || incomingText.length < 5) {
                reply = "Invalid ID. Please enter the **National ID Number** (must be numeric and at least 5 digits):";
                nextStep = 2; // Stay on step 2
                break;
            }
            state.data.national_id = nationalId; // Store the ID
            
            reply = "--- New Parent (3/6) ---\nGot it! Is the Parent/Guardian Male or Female? (Reply with M or F):";
            break;

        case 3: // Collecting Gender (Shifted from step 2)
            if (userInput === 'm' || userInput === 'male') {
                state.data.gender = "Male";
            } else if (userInput === 'f' || userInput === 'female') {
                state.data.gender = "Female";
            } else {
                reply = "Invalid input. Please reply with M for Male or F for Female:";
                nextStep = 3; // Stay on step 3
                break;
            }
            reply = "--- New Parent (4/6) ---\nGreat! Please enter the Parent's WhatsApp Number (e.g., 2547XXXXXXXX) for future reminders:";
            break;

        case 4: // Collecting WhatsApp Number (Shifted from step 3)
            if (!/^(?:254|\+254|0)?(7|1)\d{8}$/.test(incomingText)) {
                reply = "Invalid phone number format. Please ensure it starts with 2547 or 2541 (e.g., 2547XXXXXXXX):";
                nextStep = 4; // Stay on step 4
                break;
            }
            state.data.whatsapp_number = incomingText.replace(/^(0|\+)/, '254'); 
            reply = "--- New Parent (5/6) ---\nGreat! What is the Nearest Clinic to this household?";
            break;
            
        case 5: // Collecting Nearest Clinic (Shifted from step 4)
            state.data.nearest_clinic = incomingText;
            reply = "--- New Parent (6/6) ---\nAnd finally, the **Residence Location** (e.g., estate/village name)?";
            break;
            
        case 6: // Collecting Residence Location (Shifted from step 5)
            state.data.residence_location = incomingText;
            reply = `
--- Final Confirmation ---
Please review the details for the new parent:
Name: ${state.data.official_name}
ID: ${state.data.national_id}
Gender: ${state.data.gender}
WhatsApp: ${state.data.whatsapp_number}
Clinic: ${state.data.nearest_clinic}
Residence: ${state.data.residence_location}

Is this data CORRECT? Reply Y or N. (Reply N to restart this registration)
            `;
            nextStep = 7; // Move to Step 7 for Y/N input
            break;
            
        case 7: // Confirmation (Y/N) (Shifted from step 6)
            if (userInput === 'y') {
                isConfirmed = true;
                
                const TEMP_PASSWORD = 'ImmunoBotPassword123';
                
                // 🛑 FIX RE-APPLIED: Use National ID for the unique part of the email
                const uniqueEmail = `${state.data.national_id}@immunobot.com`; 

                // The full payload with collected/default values to satisfy all required API fields
                const registerPayload = {
                    first_name: firstName,
                    last_name: lastName,
                    email: uniqueEmail, // ✅ Now uses National ID
                    password: TEMP_PASSWORD, 
                    phone_number: state.data.whatsapp_number,
                    gender: state.data.gender, 
                    role: "guardian", 
                    nationality: "Kenyan", 
                    national_id: state.data.national_id, 
                    date_of_birth: "2000-01-01T00:00:00Z", 
                    address: `${state.data.nearest_clinic}, ${state.data.residence_location}`, 
                    marital_status: "Single", 
                    next_of_kin: state.data.official_name, 
                    next_of_kin_contact: state.data.whatsapp_number, 
                    no_of_children: 0, 
                    password_confirmation: TEMP_PASSWORD
                };
                
                result = await saveToLaravel('/api/register', registerPayload);

                if (result.success) {
                    reply = `Success! Parent ${state.data.official_name} (ID: ${state.data.national_id}) is successfully registered. You can now use Option 2 to register their baby/child.\n\n${MAIN_MENU}`;
                } else {
                    try {
                        const errorData = JSON.parse(result.error);
                        if (errorData.errors) {
                            const errorMessages = Object.values(errorData.errors).flat().join('\n');
                            reply = `⚠️ Registration failed! Please correct the following API errors:\n${errorMessages}\n\nType CANCEL to return to the menu.`;
                        } else {
                            reply = `Error saving data. Check the logs for details. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                        }
                    } catch (e) {
                        reply = `Error saving data. Could not process API response. Check the logs for a non-JSON error. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                    }
                }
                userState.delete(senderId); // End flow
            } else if (userInput === 'n') {
                reply = "Okay, let's start over! Please enter the Parent/Guardian's Official Name:";
                nextStep = 1;
                state.data = {}; // Clear collected data
            } else {
                reply = "I didn't quite catch that. Please reply Y to confirm the details or N to restart the registration.";
                nextStep = 7;
            }
            break;
    }

    if (!isConfirmed || (isConfirmed && !result.success)) {
        userState.set(senderId, { ...state, step: nextStep });
        await sendMessage(senderId, reply);
    } else if (isConfirmed && result.success) {
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
        case 1: // Collecting Parent's National ID
            const nationalId = parseInt(incomingText, 10);
            if (isNaN(nationalId) || nationalId <= 0 || incomingText.length < 5) {
                reply = "That doesn't look like a valid Parent's National ID. Please enter the *numeric National ID* (e.g., 12345678):";
                nextStep = 1; // Stay on Step 1
                break;
            }
            
            // ⭐️ CRITICAL: Check if the National ID exists and get the database ID
            const guardianDbId = await getGuardianIdByNationalId(nationalId);
            
            if (!guardianDbId) {
                reply = `Error: Parent with National ID ${nationalId} not found. Please register the parent first (Option 1). Type CANCEL to return to the menu.`;
                userState.delete(senderId); // End the flow
                return;
            }
            
            state.data.guardian_id = guardianDbId; // Store the *database ID* for the API payload
            state.data.guardian_national_id = nationalId; // Store the *national ID* for confirmation message
            
            reply = "--- New Baby (2/7) ---\nParent found! Please enter the baby's First Name (or official ID name):";
            break;

        case 2: // Collecting First Name
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
            
            state.data.immunization_status = "PENDING_SCHEDULE";
            state.data.last_vaccine_received = "NONE";
            state.data.next_appointment_date = null; 

            reply = `
--- Final Confirmation for Baby ---
Please review the details for the new baby:
Parent's ID: ${state.data.guardian_national_id}
Name: ${state.data.first_name} ${state.data.last_name}
Gender: ${state.data.gender}
DOB: ${state.data.date_of_birth.substring(0, 10)}
Nationality: ${state.data.nationality}

Is this data CORRECT? Reply Y or N. (Reply N to restart this registration)
            `;
            nextStep = 7; 
            break;

        case 7: // Confirmation (Y/N)
            if (userInput === 'y') {
                isConfirmed = true;
                
                const babyPayload = {
                    guardian_id: state.data.guardian_id, // The essential ID for the backend
                    first_name: state.data.first_name,
                    last_name: state.data.last_name,
                    gender: state.data.gender,
                    date_of_birth: state.data.date_of_birth,
                    nationality: state.data.nationality,
                    immunization_status: state.data.immunization_status,
                    last_vaccine_received: state.data.last_vaccine_received,
                    next_appointment_date: state.data.next_appointment_date,
                    // Note: Your backend logic should handle the creation of the immunization schedule.
                };
                
                result = await saveToLaravel('/api/babies', babyPayload);

                if (result.success) {
                    reply = `Success! Baby ${state.data.first_name} is registered under Parent ID ${state.data.guardian_national_id}. The immunization schedule will be created on your backend. Thank you for your work!\n\n${MAIN_MENU}`;
                } else {
                    try {
                        const errorData = JSON.parse(result.error);
                        if (errorData.errors) {
                            const errorMessages = Object.values(errorData.errors).flat().join('\n');
                            reply = `⚠️ Registration failed! Please correct the following API errors:\n${errorMessages}\n\nType CANCEL to return to the menu.`;
                        } else {
                            const errorMessage = errorData.message || `Error! Check logs and ensure Guardian ID ${state.data.guardian_id} exists.`;
                            reply = `Error! The baby registration failed. Type CANCEL to return to the menu.\nAPI Error: ${errorMessage.slice(0, 150)}...`;
                        }
                    } catch (e) {
                        reply = `Error! Could not process API response. Check the logs for a non-JSON error. Type CANCEL.\nAPI Error: ${String(result.error).slice(0, 150)}...`;
                    }
                }
                
                userState.delete(senderId); // End flow
            } else if (userInput === 'n') {
                reply = "Okay, let's start over! Please enter the Parent's National ID again:";
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
            nextStep = 4;
            break;

        case 4: // Confirmation (Y/N)
            if (userInput === 'y') {
                isConfirmed = true;
                
                const payload = {
                    baby_id: state.data.baby_id,
                    appointment_date: state.data.appointment_date,
                    appointment_type: 'Ad-hoc', 
                    notes: state.data.purpose_notes,
                    chw_number: state.data.chw_number,
                };
                
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
            
            const appointmentResponse = await fetchFromLaravel(`/api/appointments/${state.data.baby_id}`);
            
            if (!appointmentResponse || !appointmentResponse.appointments || appointmentResponse.appointments.length === 0) {
                reply = `No active appointments found for Baby ID ${state.data.baby_id}. Type CANCEL to return to the menu.`;
                userState.delete(senderId); // End flow
            } else {
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
            const parts = incomingText.split(',').map(p => p.trim());
            const newDate = parts[0];
            const newNote = parts.slice(1).join(', ') || "Modified by CHW via WhatsApp.";

            if (/\d{4}-\d{2}-\d{2}/.test(newDate)) {
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

    // Send the reply only if the flow hasn't been terminated (state deleted)
    if (userState.get(senderId) && reply) {
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
                            // ✅ CHANGE 2: Added support for both 'cancel' and 'CANCEL'
                            const userInput = incomingText.toLowerCase();

                            // Retrieve or initialize the user's conversation state
                            let state = userState.get(senderId);

                            // --- Global CANCEL Command (now case-insensitive check) ---
                            if (userInput === 'cancel') {
                                userState.delete(senderId);
                                sendMessage(senderId, `Conversation cancelled. Returning to the main menu.\n\n${MAIN_MENU}`);
                                continue;
                            }

                            if (!state) {
                                // --- Start of a new conversation or response to MAIN_MENU ---
                                if (userInput === '1' || userInput.includes('register parent')) {
                                    state = { flow: 'parent', step: 1, data: {} };
                                    // ✅ CHANGE 3: Updated prompt to only ask for name
                                    sendMessage(senderId, "--- New Parent (1/6) ---\nPlease enter the Parent/Guardian's Official Name:");
                                    userState.set(senderId, state);
                                } else if (userInput === '2' || userInput.includes('register baby')) {
                                    state = { flow: 'baby', step: 1, data: {} };
                                    sendMessage(senderId, "--- New Baby (1/7) ---\nPlease enter the **Parent/Guardian's National ID Number** to link the baby:");
                                    userState.set(senderId, state);
                                } else if (userInput === '3' || userInput.includes('create appointment')) {
                                    state = { flow: 'appointment', step: 1, data: {} };
                                    sendMessage(senderId, "--- New Appointment (1/4) ---\nPlease enter the *Baby ID* for this ad-hoc appointment:");
                                    userState.set(senderId, state);
                                } else if (userInput === '4' || userInput.includes('modify cancel')) {
                                     state = { flow: 'modify_cancel', step: 1, data: {} };
                                    sendMessage(senderId, "--- Modify/Cancel Appointment (1/2) ---\nPlease enter the *Baby ID* to view active appointments:");
                                    userState.set(senderId, state);
                                } else {
                                    // Send the introductory and main menu message
                                    sendMessage(senderId, `${INTRO_MESSAGE}\n\n${MAIN_MENU}`);
                                }
                            } else {
                                // --- Continue an existing flow ---
                                try {
                                    if (state.flow === 'parent') {
                                        handleRegisterParent(senderId, state, incomingText, userInput);
                                    } else if (state.flow === 'baby') {
                                        handleRegisterBaby(senderId, state, incomingText, userInput);
                                    } else if (state.flow === 'appointment') {
                                        handleCreateAppointment(senderId, state, incomingText, userInput);
                                    } else if (state.flow === 'modify_cancel') {
                                        handleModifyCancelAppointment(senderId, state, incomingText, userInput);
                                    }
                                } catch (error) {
                                    console.error(`Error in flow handler for ${senderId} (${state.flow}):`, error);
                                    sendMessage(senderId, "⚠️ An unexpected error occurred. Type CANCEL to return to the main menu.");
                                    userState.delete(senderId);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`\nServer is running on port ${port}`);
    console.log(`WhatsApp Webhook listening at http://localhost:${port}/whatsapp/webhook`);
});