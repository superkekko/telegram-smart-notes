import { GoogleGenAI } from "@google/genai";
import 'dotenv/config'; 

// Inizializza l'API con la chiave dal file .env
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MAX_RETRIES = 3; 

// SCHEMA DI CLASSIFICAZIONE
const classificationSchema = {
    type: "OBJECT",
    properties: {
        task: {
            type: "STRING",
            description: "Il testo centrale della nota o del compito da svolgere, depurato dalle informazioni di scadenza."
        },
        deadline: {
            type: "STRING",
            description: "La scadenza nel formato YYYY-MM-DD HH:MM:SS. Se non è specificata una scadenza, lascia vuoto."
        },
        recurrence: { 
            type: "STRING", 
            enum: ["daily", "weekly", "monthly", "yearly", null],
            description: "Frequenza dell'attività se ripetitiva (es. ogni giorno, ogni settimana)." 
        }
    },
    required: ["task"]
};

// Classifica il testo della nota usando il modello Gemini.
export async function classifyInput(text) {
    const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    
    const systemPrompt = `
    	Sei un assistente personale. Analizza il testo fornito ed estrai i dettagli del promemoria.
	    CONTESTO TEMPORALE CORRENTE: ${now}
    
	    Regole di estrazione:
	    1. Estrai l'azione o il compito principale in 'task'.
	    2. La 'deadline' deve essere nel formato: YYYY-MM-DD HH:MM:SS. Se non c'è una scadenza esplicita, lasciala vuota. Se viene indicata solo una data (es. "domani"), imposta le 09:00:00 come orario predefinito.
	    3. Se l'utente indica una ripetizione (es. 'ogni giorno', 'tutti i martedì', 'ogni mese') identifica la ricorrenza come 'daily', 'weekly', 'monthly' o 'yearly'. La 'deadline' deve corrispondere al primo giorno utile in cui eseguire l'attività.`;
    	
    const prompt = `Classifica la seguente nota in formato JSON:\n\n"${text}"`;
    
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

            // Se la risposta è valida, ritorna il JSON
            const jsonResponse = response.text.trim();
            return JSON.parse(jsonResponse);

        } catch (error) {
            console.error(`[API Error - Tentativo ${attempt}/${MAX_RETRIES}]:`, error.message);
            
            // Controlla se l'errore è ritentabile
            const isRetryableError = error.message.includes('503') || error.message.includes('overloaded') || attempt < MAX_RETRIES;

            if (attempt < MAX_RETRIES && isRetryableError) {
                // Backoff Esponenziale: 2s, 4s
                const delayMs = Math.pow(2, attempt) * 1000;
                console.log(`Ritento tra ${delayMs / 1000} secondi...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            } else {
                // CLASSIFICAZIONE DI DEFAULT (FALLBACK) DOPO L'ULTIMO TENTATIVO FALLITO
                console.warn(`Classificazione AI fallita dopo ${attempt} tentativi.`);
                
                return {
                    task: text,     
                    deadline: null, 
                    recurrence: null
                };
            }
        }
    }
}