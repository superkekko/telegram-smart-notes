import { startScheduler } from './scheduler-service.js';
import {
    saveNote,
    getNotes,
    completeNote,
    getNoteById,
    initializeDb,
    deleteNote,
    getSystemStats,
    isUserInDb,
    addAuthorizedUser,
    saveAuthCode
} from './db-service.js';
import { classifyInput } from './nlp-service.js';
import { formatNoteForReply, escapeMarkdown } from './utils.js';
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { startWebServer } from './web-server.js';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let bot;
const POLLING_RESTART_DELAY = 10000;

export const MASTER_ADMINS = process.env.AUTHORIZED_CHAT_IDS
    ? process.env.AUTHORIZED_CHAT_IDS.split(',').map(id => id.trim())
    : [];

const isAuthorized = async (chatId) => {
    const idStr = String(chatId);
    if (MASTER_ADMINS.includes(idStr)) return true;
    const user = await isUserInDb(idStr);
    return !!user;
};

async function sendNotesList(notes, chatId) {
    if (notes.length === 0) {
        await bot.sendMessage(chatId, `✅ Nessun promemoria attivo trovato.`);
        return;
    }

    for (const note of notes) {
        const { text: message, markup: keyboard } = formatNoteForReply(note, true);
        await new Promise(resolve => setTimeout(resolve, 100));

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
}

async function processAndSaveInput(chatId, classification, fileId = null, localPath = null) {
    const noteId = await saveNote(chatId, classification, { fileId, localPath });
    const savedNote = await getNoteById(noteId, chatId);
    const { text: replyText, markup: replyMarkup } = formatNoteForReply(savedNote, false, false);

    await bot.sendMessage(chatId, replyText, {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
    });
}

async function setBotCommands(bot) {
    const commands = [
        { command: 'list', description: 'Visualizza i tuoi promemoria attivi' },
        { command: 'help', description: 'Informazioni su come usare il bot' },
        { command: 'login', description: 'Accedi alla web dashboard' }
    ];

    try {
        await bot.setMyCommands(commands);
        console.log("✅ Comandi del bot registrati su Telegram.");
    } catch (error) {
        console.error("❌ Errore durante la registrazione dei comandi:", error);
    }
}

function setupBotListeners() {
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) {
            return bot.sendMessage(chatId, '❌ Accesso non autorizzato. Contatta l\'amministratore.');
        }

        const welcomeMessage = ` Benvenuto nel sistema *Smart Assistant*!\n\n` +
                                `Sono il tuo assistente personale per i promemoria.\n\n` +
                                `Usa /help per vedere l'elenco dei comandi.\n\n` +
                                `*Per aggiungere una nota*, scrivi semplicemente cosa vuoi ricordare (es. _comprare il latte domani mattina alle 9_ o _ricordami di chiamare la banca tra mezz'ora_).`;

        await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/login/, async (msg) => {
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) return;

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await saveAuthCode(String(chatId), code);

        const baseUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
        const loginUrl = `${baseUrl}?chatId=${chatId}`;

        await bot.sendMessage(chatId,
            ` *Accesso Dashboard*\n\nIl tuo codice: \`${code}\`\n\n[Clicca qui per entrare](${loginUrl})`,
            { parse_mode: 'Markdown' }
        );
    });

    bot.onText(/\/authorize (\d+)(?:\s+(.+))?/, async (msg, match) => {
        const senderId = String(msg.chat.id);
        if (!MASTER_ADMINS.includes(senderId)) {
            return bot.sendMessage(senderId, "❌ Comando riservato ai Master Admin.");
        }

        const targetId = match[1];
        const manualName = match[2];

        try {
            let name = "Utente";
            let username = "N/A";

            if (manualName) {
                name = manualName;
            } else {
                try {
                    const chat = await bot.getChat(targetId);
                    name = chat.first_name || "Utente";
                    username = chat.username ? `@${chat.username}` : "N/A";
                } catch (e) {
                    console.log("⚠️ getChat fallito, uso nome di default.");
                    name = "Utente Sconosciuto";
                }
            }

            await addAuthorizedUser(targetId, name, username !== "N/A" ? username : null);

            await bot.sendMessage(senderId,
                `✅ **Utente Autorizzato**\n Nome: ${escapeMarkdown(name)}\n ID: \`${targetId}\``,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error("Errore durante l'autorizzazione:", error);
            bot.sendMessage(senderId, "⚠️ Errore durante il salvataggio dell'utente.");
        }
    });

    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        if (!MASTER_ADMINS.includes(String(chatId))) {
            return bot.sendMessage(chatId, "❌ Comando riservato ai Master Admin.");
        }

        const dbStats = await getSystemStats();

        let statusMessage = ` **SYSTEM HEALTH REPORT** \n\n`;
        statusMessage += ` **DB Size:** ${dbStats.dbSize} MB\n\n`;
        statusMessage += ` **CONTENUTI**\n`;
        statusMessage += ` Note totali: ${dbStats.notes}\n`;
        statusMessage += ` Utenti autorizzati: ${dbStats.users}\n\n`;
        statusMessage += `✅ Sistema operativo e online.`;

        await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) return;

        const helpMessage = ` *Guida Comandi Smart Assistant:*\n\n` +
                                `*Gestione Note:*\n` +
                                `  /list \- Mostra tutti i promemoria attivi (ognuno ha i suoi pulsanti *Fatto/Cancella*).\n` +
                                `  /login \- Accedi alla web dashboard.`;

        await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    });

    bot.onText(/\/list/, async (msg) => {
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) return;

        const activeNotes = await getNotes(chatId, ['active', 'notified']);
        await sendNotesList(activeNotes, chatId);
    });

    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) return;

        // Pattern semplificato per sole note
        const match = action.match(/^(DONE_NOTE|DELETE_NOTE|VIEWFILE_NOTE)_(\d+)$/);
        if (!match) return;

        const operation = match[1];
        const inputId = parseInt(match[2]);

        try {
            if (operation === 'DONE_NOTE') {
                const note = await getNoteById(inputId, chatId);
                const success = await completeNote(inputId, chatId);
                if (success && note.recurrence) {
                    await bot.editMessageText(`✅ Nota ricorrente rinnovata.`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    });
                } else if (success) {
                    await bot.editMessageText(`✅ Promemoria completato.`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await bot.editMessageText(`Promemoria non modificato (già completato o inesistente).`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    });
                }
            } else if (operation === 'DELETE_NOTE') {
                const success = await deleteNote(inputId, chatId);
                if (success) {
                    await bot.editMessageText(`❌ Promemoria eliminato.`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await bot.editMessageText(`❌ Errore: Promemoria non trovato.`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    });
                }
            } else if (operation === 'VIEWFILE_NOTE') {
                const note = await getNoteById(inputId, chatId);

                if (note && note.localPath) {
                    const absolutePath = path.resolve(note.localPath);
                    if (fs.existsSync(absolutePath)) {
                        try {
                            await bot.sendChatAction(chatId, 'upload_document');
                            await bot.sendDocument(chatId, fs.createReadStream(absolutePath), {
                                caption: ` Allegato per: ${note.task}`
                            });
                            await bot.answerCallbackQuery(callbackQuery.id);
                        } catch (err) {
                            console.error("❌ Errore invio file fisico:", err);
                            await bot.answerCallbackQuery(callbackQuery.id, { text: "Errore tecnico nell'invio del file." });
                        }
                    } else {
                        await bot.answerCallbackQuery(callbackQuery.id, { text: "File non trovato sul disco." });
                    }
                }
            }
        } catch (error) {
            console.error(`❌ ERRORE nella gestione del callback ${action}:`, error);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Si è verificato un errore.' });
        }
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) return;
        if (msg.text?.startsWith('/')) return;
        const textToClassify = msg.text || msg.caption || "";

        let fileId = null;
        let localPath = null;

        if (msg.photo || msg.document) {
            fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
            try {
                const downloadPath = await bot.downloadFile(fileId, './data/attachments');
                localPath = downloadPath;
            } catch (err) {
                console.error("❌ Errore nel download del file:", err);
            }
        }

        if (!textToClassify && !fileId) return;
        let classification = null;

        try {
            await bot.sendChatAction(chatId, 'typing');
            classification = await classifyInput(textToClassify || "Promemoria solo con allegato");
            await processAndSaveInput(chatId, classification, fileId, localPath);
        } catch (error) {
            console.error('❌ ERRORE nella classificazione/salvataggio automatico:', error);
            await bot.sendMessage(chatId, '❌ Si è verificato un errore durante la classificazione. Riprova più tardi.');
        }
    });
}

function startBotPolling() {
    if (bot) {
        try { bot.stopPolling(); } catch (e) { console.warn('⚠️ Errore arresto polling:', e.message); }
    }

    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    setBotCommands(bot);
    setupBotListeners();

    bot.on('polling_error', (error) => {
        if (error.code === 'EFATAL' && error.message.includes('401')) {
            console.error('❌ [POLLING FATALE] Token Telegram non valido o scaduto.');
            return;
        }

        bot.stopPolling()
           .then(() => {
               setTimeout(startBotPolling, POLLING_RESTART_DELAY);
           })
           .catch(err => {
               setTimeout(startBotPolling, POLLING_RESTART_DELAY);
           });
    });
}

export async function startSystem() {
    try {
        console.log("⌛ Sistema Smart Assistant in avvio...");
        await initializeDb();
        console.log("✅ Database SQLite inizializzato.");
        startBotPolling();
        startScheduler(() => bot);
        startWebServer();
        console.log('✅ Polling, Schedulatore e Dashboard Web attivi!');
    } catch (err) {
        console.error("❌ ERRORE FATALE: Impossibile avviare il sistema:", err);
        process.exit(1);
    }
}

startSystem();
