import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const REMINDER_ACCESS_TOKEN = process.env.REMINDER_WHATSAPP_TOKEN;
const REMINDER_PHONE_ID = process.env.REMINDER_PHONE_NUMBER_ID;

// API endpoint that Laravel will call
app.post("/send-reminder", async (req, res) => {
    try {
        const { to, message } = req.body;

        if (!to || !message) {
            return res.status(400).json({ error: "Missing to/message" });
        }

        const response = await axios.post(`https://graph.facebook.com/v20.0/${REMINDER_PHONE_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to,
                text: { body: message }
            },
            {
                headers: {
                    Authorization: `Bearer ${REMINDER_ACCESS_TOKEN}`,
                    "Content-Type": "application/json"
                },
            }
        );

        return res.json({ status: "Reminder sent", response: response.data });
    } catch (err) {
        console.error(err.response?.data || err);
        return res.status(500).json({ error: "Failed to send reminder" });
    }
});

app.listen(4001, () => console.log("Reminder Server running on port 4001"));