import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import {
    getExpiredNotes,
    markNoteAsNotified,
    getNoteById,
    getUncompletedExpiredNotes
} from './db-service.js';
import { formatNoteForReply } from './utils.js';

export function startScheduler(getBot) {

    /*
     * Esecuzione notifiche (ogni 5 minuti)
     */
    cron.schedule('*/5 * * * *', async () => {
        const bot = getBot();
        if (!bot) return;

        try {
            const expiredNotes = await getExpiredNotes();
            if (expiredNotes.length === 0) return;

            for (const simpleNote of expiredNotes) {
                const fullNote = await getNoteById(simpleNote.id, simpleNote.chatId);

                if (!fullNote) {
                    console.warn(`Schedulatore: Nota ID #${simpleNote.id} non trovata, saltata.`);
                    continue;
                }

                if (fullNote.localPath) {
                    try {
                        const absolutePath = path.resolve(fullNote.localPath);
                        if (fs.existsSync(absolutePath)) {
                            await bot.sendDocument(fullNote.chatId, absolutePath, {
                                caption: ` Allegato per: ${fullNote.task}`
                            });
                        }
                    } catch (err) {
                        console.error(`Errore invio file locale per nota ${fullNote.id}:`, err);
                    }
                }

                const { text: message, markup: keyboard } = formatNoteForReply(fullNote, false, true);

                await bot.sendMessage(fullNote.chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });

                await markNoteAsNotified(fullNote.id);
                console.log(`Schedulatore: Notifica TEMPORALE completa inviata per ID #${fullNote.id} a chat ${fullNote.chatId}`);
            }
        } catch (error) {
            console.error('ERRORE nello Schedulatore (Tempo):', error);
        }
    });

    /*
     * Riepilogo Quotidiano Note Scadute (Ogni giorno alle 09:00)
     */
    cron.schedule('0 9 * * *', async () => {
        const bot = getBot();
        if (!bot) return;

        try {
            const uncompletedExpiredNotes = await getUncompletedExpiredNotes();
            if (uncompletedExpiredNotes.length === 0) return;

            const notesByChat = {};
            uncompletedExpiredNotes.forEach(note => {
                const chatId = String(note.chatId);
                if (!notesByChat[chatId]) {
                    notesByChat[chatId] = [];
                }
                notesByChat[chatId].push(note);
            });

            const chatIdsToNotify = Object.keys(notesByChat);

            for (const chatId of chatIdsToNotify) {
                const notes = notesByChat[chatId];

                await bot.sendMessage(chatId,
                    `*ATTENZIONE: Riepilogo delle Note SCADUTE non Completate*\n\nHai *${notes.length}* promemoria scaduti in sospeso:`
                , { parse_mode: 'Markdown' });

                for (const note of notes) {
                    const { text: message, markup: keyboard } = formatNoteForReply(note, true, false);
                    await new Promise(resolve => setTimeout(resolve, 100));

                    await bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                }
                console.log(`Schedulatore: Riepilogo SCADUTI inviato a chat ${chatId} con ${notes.length} note.`);
            }
        } catch (error) {
            console.error('ERRORE nello Schedulatore (Riepilogo Scaduti):', error);
        }
    });
}
