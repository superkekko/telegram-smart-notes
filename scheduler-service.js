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
import { t, TIMEZONE } from './i18n.js';

export function startScheduler(getBot) {

    /*
     * Deadline notifications (every 5 minutes)
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
                    console.warn(`Scheduler: note #${simpleNote.id} not found, skipped.`);
                    continue;
                }

                if (fullNote.localPath) {
                    try {
                        const absolutePath = path.resolve(fullNote.localPath);
                        if (fs.existsSync(absolutePath)) {
                            await bot.sendDocument(fullNote.chatId, absolutePath, {
                                caption: t('bot.note.attachment_caption', { task: fullNote.task })
                            });
                        }
                    } catch (err) {
                        console.error(`Error while sending local file for note ${fullNote.id}:`, err);
                    }
                }

                const { text: message, markup: keyboard } = formatNoteForReply(fullNote, false, true);

                await bot.sendMessage(fullNote.chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });

                await markNoteAsNotified(fullNote.id);
                console.log(`Scheduler: notification sent for note #${fullNote.id} to chat ${fullNote.chatId}`);
            }
        } catch (error) {
            console.error('Scheduler ERROR (deadlines):', error);
        }
    }, { timezone: TIMEZONE });

    /*
     * Daily summary of overdue notes (every day at 09:00, in the configured timezone)
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

            for (const chatId of Object.keys(notesByChat)) {
                const notes = notesByChat[chatId];

                await bot.sendMessage(chatId,
                    t('scheduler.overdue_summary', { count: notes.length }),
                    { parse_mode: 'Markdown' }
                );

                for (const note of notes) {
                    const { text: message, markup: keyboard } = formatNoteForReply(note, true, false);
                    await new Promise(resolve => setTimeout(resolve, 100));

                    await bot.sendMessage(chatId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    });
                }
                console.log(`Scheduler: overdue summary sent to chat ${chatId} (${notes.length} notes).`);
            }
        } catch (error) {
            console.error('Scheduler ERROR (overdue summary):', error);
        }
    }, { timezone: TIMEZONE });
}
