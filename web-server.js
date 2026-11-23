import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
    getNotes,
    completeNote,
    deleteNote,
    createSession,
    getSession,
    verifyAuthCode
} from './db-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Età massima accettata per un initData della Telegram Mini App, in secondi.
// Oltre questa soglia l'initData viene rifiutato anche se la firma è valida,
// per limitare il rischio di riutilizzo di dati intercettati (replay).
const TMA_MAX_AGE_SECONDS = 24 * 60 * 60; // 24 ore
// Piccola tolleranza per eventuale disallineamento d'orologio tra client e server.
const TMA_CLOCK_SKEW_TOLERANCE_SECONDS = 5 * 60; // 5 minuti

function verifyTmaData(initData) {
    if (!initData) return false;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');

    const authDate = params.get('auth_date');
    if (!authDate) return false;

    const ageSeconds = Math.floor(Date.now() / 1000) - parseInt(authDate, 10);
    if (
        Number.isNaN(ageSeconds) ||
        ageSeconds > TMA_MAX_AGE_SECONDS ||
        ageSeconds < -TMA_CLOCK_SKEW_TOLERANCE_SECONDS
    ) {
        return false;
    }

    const dataCheckString = Array.from(params.entries())
        .map(([key, value]) => `${key}=${value}`).sort().join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData')
        .update(process.env.TELEGRAM_BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey)
        .update(dataCheckString).digest('hex');
    return calculatedHash === hash;
}

// Middleware di sbarramento per controllare il token di sessione della dashboard
async function checkAuth(req, res, next) {
    const token = req.headers['authorization'];
    const chatId = req.query.chatId || req.body?.chatId;

    const session = await getSession(token);
    if (!session || session.chatId !== String(chatId)) {
        return res.status(403).json({ error: "Sessione non valida o scaduta" });
    }
    req.chatId = session.chatId;
    next();
}

export function startWebServer() {
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // Autenticazione automatica (Telegram Mini App)
    app.post('/api/auth/telegram', async (req, res) => {
        const { initData } = req.body;
        if (!verifyTmaData(initData)) return res.status(401).send();

        const user = JSON.parse(new URLSearchParams(initData).get('user'));
        const token = await createSession(String(user.id));
        res.json({ token, chatId: String(user.id) });
    });

    // Autenticazione manuale tramite codice a 6 cifre generato con /login
    app.post('/api/auth/code', async (req, res) => {
        const { chatId, code } = req.body || {};
        if (!chatId || !code) {
            return res.status(400).json({ error: "chatId e code sono obbligatori" });
        }

        const valid = await verifyAuthCode(chatId, code);
        if (!valid) {
            return res.status(401).json({ error: "Codice non valido o scaduto" });
        }

        const token = await createSession(String(chatId));
        res.json({ token, chatId: String(chatId) });
    });

    // API Task (Note)
    app.get('/api/tasks', checkAuth, async (req, res) => {
        const tasks = await getNotes(req.chatId, ['active', 'notified']);
        res.json(tasks);
    });

    // Segna Task come Completato / Rinnova se Ricorrente
    app.post('/api/tasks/:id/complete', checkAuth, async (req, res) => {
        const taskId = parseInt(req.params.id);
        try {
            const success = await completeNote(taskId, req.chatId);
            if (success) {
                res.json({ success: true, message: "Task aggiornato con successo" });
            } else {
                res.status(404).json({ error: "Task non trovato o non modificato" });
            }
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Elimina Definitivamente il Task
    app.delete('/api/tasks/:id', checkAuth, async (req, res) => {
        const taskId = parseInt(req.params.id);
        try {
            const success = await deleteNote(taskId, req.chatId);
            if (success) {
                res.json({ success: true, message: "Task eliminato con successo" });
            } else {
                res.status(404).json({ error: "Task non trovato" });
            }
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    const PORT = process.env.WEB_PORT || 3000;
    app.listen(PORT, () => console.log(`🌐 Dashboard attiva su porta ${PORT}`));
}
