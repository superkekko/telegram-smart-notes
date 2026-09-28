import { GoogleGenAI } from "@google/genai";
import 'dotenv/config';
import { TIMEZONE } from './i18n.js';
import { formatIsoNow } from './utils.js';

// Initialize the API with the key from the .env file
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_RETRIES = 3;

// CLASSIFICATION SCHEMA
const classificationSchema = {
    type: "OBJECT",
    properties: {
        task: {
            type: "STRING",
            description: "The core text of the note or task to perform, without the deadline information. Keep the same language as the user's text."
        },
        deadline: {
            type: "STRING",
            description: "The deadline in the format YYYY-MM-DD HH:MM:SS. If no deadline is specified, leave empty."
        },
        recurrence: {
            type: "STRING",
            enum: ["daily", "weekly", "monthly", "yearly", null],
            description: "Frequency of the activity if it is repeating (e.g. every day, every week)."
        }
    },
    required: ["task"]
};

// Classifies the note text using the Gemini model.
// The user's text can be written in any language.
export async function classifyInput(text) {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TIMEZONE }).format(new Date());
    const now = `${formatIsoNow()} (${weekday})`;

    const systemPrompt = `
You are a personal assistant. Analyze the provided text and extract the reminder details.
The text may be written in any language.
CURRENT DATE AND TIME (timezone ${TIMEZONE}): ${now}

Extraction rules:
1. Extract the main action or task into 'task', keeping the user's original language and removing the deadline/recurrence wording.
2. 'deadline' must be in the format YYYY-MM-DD HH:MM:SS, expressed in the timezone above. If there is no explicit deadline, leave it empty. If only a date is given (e.g. "tomorrow"), use 09:00:00 as the default time.
3. If the user indicates a repetition (e.g. 'every day', 'every Tuesday', 'every month'), set the recurrence to 'daily', 'weekly', 'monthly' or 'yearly'. The 'deadline' must be the first upcoming date on which the activity has to be performed.`;

    const prompt = `Classify the following note as JSON:\n\n"${text}"`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    systemInstruction: systemPrompt,
                    responseMimeType: 'application/json',
                    responseSchema: classificationSchema,
                },
            });

            // If the response is valid, return the parsed JSON
            return JSON.parse(response.text.trim());

        } catch (error) {
            console.error(`[API Error - Attempt ${attempt}/${MAX_RETRIES}]:`, error.message);

            if (attempt < MAX_RETRIES) {
                // Exponential backoff: 2s, 4s
                const delayMs = Math.pow(2, attempt) * 1000;
                console.log(`Retrying in ${delayMs / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
                // DEFAULT CLASSIFICATION (FALLBACK) AFTER THE LAST FAILED ATTEMPT
                console.warn(`AI classification failed after ${attempt} attempts.`);

                return {
                    task: text,
                    deadline: null,
                    recurrence: null
                };
            }
        }
    }
}
