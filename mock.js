import express from 'express';

const app = express();
const PORT = 8000;

// Use built-in body parser for JSON payloads
app.use(express.json());

// --- Mock Data Store ---
const mockGuardians = [
    { id: 101, first_name: "Cyrus", last_name: "Ngugi", phone_number: "254712345678" },
    { id: 102, first_name: "Jane", last_name: "Wanjiru", phone_number: "254700112233" }
];
const mockBabies = [];

// --- API Endpoints Mockup ---

// 1. POST /api/babies - Store a newly created resource
app.post('/api/babies', (req, res) => {
    const newBabyData = req.body;
    console.log(`\n[MOCK API] Received POST /api/babies`);
    
    // Simple validation (must have guardian_id and first_name)
    if (!newBabyData.guardian_id || !newBabyData.first_name) {
        console.error("  -> Validation failed: Missing required fields.");
        return res.status(400).json({ error: "Missing required fields (guardian_id or first_name)." });
    }

    // Simulate saving and assigning a new ID
    const newId = mockBabies.length + 501;
    const babyRecord = {
        id: newId,
        ...newBabyData,
        created_at: new Date().toISOString()
    };
    
    mockBabies.push(babyRecord);

    console.log(`  -> SUCCESS: Baby registered (ID: ${newId}).`);
    // Return a 201 Created status with the new resource
    return res.status(201).json({ 
        message: "Baby successfully registered and schedule initiated.",
        baby: babyRecord
    });
});

// 2. GET /api/babies - Display a listing of the resource
app.get('/api/babies', (req, res) => {
    console.log(`\n[MOCK API] Received GET /api/babies`);
    // Return the mock list of babies
    return res.status(200).json({ babies: mockBabies });
});


// 3. GET /api/guardians - Return all the guardians
app.get('/api/guardians', (req, res) => {
    console.log(`\n[MOCK API] Received GET /api/guardians`);
    // Return the mock list of guardians
    return res.status(200).json({ guardians: mockGuardians });
});

// 4. Fallback for unmocked routes (like GET/PUT/DELETE /babies/{id} or PUT /guardians/{id})
app.all('/api/*', (req, res) => {
    console.log(`\n[MOCK API] Received unmocked route: ${req.method} ${req.originalUrl}`);
    return res.status(501).json({ 
        message: "Endpoint successfully received by Mock API but not fully implemented (200 OK for now).",
        method: req.method
    });
});


// Start the server
app.listen(PORT, () => {
    console.log(`
------------------------------------------------------
✅ Mock API Server is running on http://127.0.0.1:${PORT}
   Set LARAVEL_API_BASE=http://127.0.0.1:${PORT}/api in your bot's .env file.
------------------------------------------------------
`);
});