import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
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
import { startWebServer } from './web-server.js';
import { t, LANGUAGE, TIMEZONE } from './i18n.js';

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
        await bot.sendMessage(chatId, t('bot.list.empty'));
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
        { command: 'list', description: t('bot.cmd.list') },
        { command: 'help', description: t('bot.cmd.help') },
        { command: 'login', description: t('bot.cmd.login') }
    ];

    try {
        await bot.setMyCommands(commands);
        console.log("✅ Bot commands registered on Telegram.");
    } catch (error) {
        console.error("❌ Error while registering bot commands:", error);
    }
}

function setupBotListeners() {
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) {
            return bot.sendMessage(chatId, t('bot.unauthorized'));
        }

        await bot.sendMessage(chatId, t('bot.welcome'), { parse_mode: 'Markdown' });
    });

    bot.onText(/\/login/, async (msg) => {
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) return;

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await saveAuthCode(String(chatId), code);

        const baseUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
        const loginUrl = `${baseUrl}?chatId=${chatId}`;

        await bot.sendMessage(chatId,
            t('bot.login', { code, url: loginUrl }),
            { parse_mode: 'Markdown' }
        );
    });

    bot.onText(/\/authorize (\d+)(?:\s+(.+))?/, async (msg, match) => {
        const senderId = String(msg.chat.id);
        if (!MASTER_ADMINS.includes(senderId)) {
            return bot.sendMessage(senderId, t('bot.admin_only'));
        }

        const targetId = match[1];
        const manualName = match[2];

        try {
            let name = t('bot.authorize.default_name');
            let username = null;

            if (manualName) {
                name = manualName;
            } else {
                try {
                    const chat = await bot.getChat(targetId);
                    name = chat.first_name || name;
                    username = chat.username ? `@${chat.username}` : null;
                } catch (e) {
                    console.log("⚠️ getChat failed, using the default name.");
                    name = t('bot.authorize.unknown_name');
                }
            }

            await addAuthorizedUser(targetId, name, username);

            await bot.sendMessage(senderId,
                t('bot.authorize.success', { name: escapeMarkdown(name), id: targetId }),
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error("Error while authorizing user:", error);
            bot.sendMessage(senderId, t('bot.authorize.error'));
        }
    });

    bot.onText(/\/stats/, async (msg) => {
        const chatId = msg.chat.id;
        if (!MASTER_ADMINS.includes(String(chatId))) {
            return bot.sendMessage(chatId, t('bot.admin_only'));
        }

        const dbStats = await getSystemStats();
        await bot.sendMessage(chatId, t('bot.stats', dbStats), { parse_mode: 'Markdown' });
    });

    bot.onText(/\/help/, async (msg) => {
        const chatId = msg.chat.id;
        if (!(await isAuthorized(chatId))) return;

        await bot.sendMessage(chatId, t('bot.help'), { parse_mode: 'Markdown' });
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

        const match = action.match(/^(DONE_NOTE|DELETE_NOTE|VIEWFILE_NOTE)_(\d+)$/);
        if (!match) return;

        const operation = match[1];
        const inputId = parseInt(match[2]);

        const editMessage = (text) => bot.editMessageText(text, {
            chat_id: chatId,
            message_id: msg.message_id,
            parse_mode: 'Markdown'
        });

        try {
            if (operation === 'DONE_NOTE') {
                const note = await getNoteById(inputId, chatId);
                const success = await completeNote(inputId, chatId);
                if (success && note.recurrence) {
                    await editMessage(t('bot.note.done_recurring'));
                } else if (success) {
                    await editMessage(t('bot.note.done'));
                } else {
                    await editMessage(t('bot.note.done_noop'));
                }
            } else if (operation === 'DELETE_NOTE') {
                const success = await deleteNote(inputId, chatId);
                await editMessage(success ? t('bot.note.deleted') : t('bot.note.not_found'));
            } else if (operation === 'VIEWFILE_NOTE') {
                const note = await getNoteById(inputId, chatId);

                if (note && note.localPath) {
                    const absolutePath = path.resolve(note.localPath);
                    if (fs.existsSync(absolutePath)) {
                        try {
                            await bot.sendChatAction(chatId, 'upload_document');
                            await bot.sendDocument(chatId, fs.createReadStream(absolutePath), {
                                caption: t('bot.note.attachment_caption', { task: note.task })
                            });
                            await bot.answerCallbackQuery(callbackQuery.id);
                        } catch (err) {
                            console.error("❌ Error while sending the file:", err);
                            await bot.answerCallbackQuery(callbackQuery.id, { text: t('bot.file.error') });
                        }
                    } else {
                        await bot.answerCallbackQuery(callbackQuery.id, { text: t('bot.file.missing') });
                    }
                }
            }
        } catch (error) {
            console.error(`❌ ERROR while handling callback ${action}:`, error);
            await bot.answerCallbackQuery(callbackQuery.id, { text: t('bot.callback.error') });
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
                localPath = await bot.downloadFile(fileId, './data/attachments');
            } catch (err) {
                console.error("❌ Error while downloading the file:", err);
            }
        }

        if (!textToClassify && !fileId) return;

        try {
            await bot.sendChatAction(chatId, 'typing');
            const classification = await classifyInput(textToClassify || t('bot.note.attachment_only'));
            await processAndSaveInput(chatId, classification, fileId, localPath);
        } catch (error) {
            console.error('❌ ERROR during automatic classification/saving:', error);
            await bot.sendMessage(chatId, t('bot.classify.error'));
        }
    });
}

function startBotPolling() {
    if (bot) {
        try { bot.stopPolling(); } catch (e) { console.warn('⚠️ Error while stopping polling:', e.message); }
    }

    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    setBotCommands(bot);
    setupBotListeners();

    bot.on('polling_error', (error) => {
        if (error.code === 'EFATAL' && error.message.includes('401')) {
            console.error('❌ [FATAL POLLING ERROR] Telegram token invalid or expired.');
            return;
        }

        bot.stopPolling()
           .then(() => {
               setTimeout(startBotPolling, POLLING_RESTART_DELAY);
           })
           .catch(() => {
               setTimeout(startBotPolling, POLLING_RESTART_DELAY);
           });
    });
}

export async function startSystem() {
    try {
        console.log(`⌛ Starting Smart Assistant (language: ${LANGUAGE}, timezone: ${TIMEZONE})...`);
        await initializeDb();
        console.log("✅ SQLite database initialized.");
        startBotPolling();
        startScheduler(() => bot);
        startWebServer();
        console.log('✅ Polling, scheduler and web dashboard are up!');
    } catch (err) {
        console.error("❌ FATAL ERROR: unable to start the system:", err);
        process.exit(1);
    }
}

startSystem();
