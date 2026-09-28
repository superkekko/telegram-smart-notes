import { addDays, addWeeks, addMonths, addYears, parseISO, format } from 'date-fns';
import fs from 'fs';
import path from 'path';
import { t, TIMEZONE, DATE_FORMAT } from './i18n.js';

export function getLocalFilePath(fileName) {
    const dir = './data/attachments';
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, fileName);
}

export function deleteLocalFile(filePath) {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`File deleted: ${filePath}`);
        }
    } catch (err) {
        console.error(`Error while deleting file ${filePath}:`, err);
    }
}

export function calculateNextOccurrence(currentDeadline, recurrence, includeTime = true) {
    const date = parseISO(currentDeadline.replace(' ', 'T'));
    let nextDate;

    switch (recurrence) {
        case 'daily': nextDate = addDays(date, 1); break;
        case 'weekly': nextDate = addWeeks(date, 1); break;
        case 'monthly': nextDate = addMonths(date, 1); break;
        case 'yearly': nextDate = addYears(date, 1); break;
        default: return currentDeadline;
    }

    return includeTime
        ? format(nextDate, 'yyyy-MM-dd HH:mm:ss')
        : format(nextDate, 'yyyy-MM-dd');
}

// Current date/time in the configured TIMEZONE, as "YYYY-MM-DD HH:mm:ss" (or date only)
export function formatIsoNow(includeTime = true) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: TIMEZONE,
        hour12: false
    }).formatToParts(new Date());

    const d = {};
    parts.forEach(({ type, value }) => d[type] = value);

    const hour = d.hour === '24' ? '00' : d.hour;
    const dateStr = `${d.year}-${d.month}-${d.day}`;

    return includeTime
        ? `${dateStr} ${hour}:${d.minute}:${d.second}`
        : dateStr;
}

// Escapes the special characters of Telegram's "legacy" Markdown (parse_mode: 'Markdown'),
// so dynamic text (e.g. a note typed by the user) cannot break formatting or make
// sendMessage fail when it contains characters like _ * ` [
export function escapeMarkdown(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/([_*`[])/g, '\\$1');
}

export function formatNoteForReply(note, isList = false, isNotification = false) {
    const date = note.deadline ? new Date(note.deadline) : null;
    let message = '';

    if (isNotification) {
        message += t('note.header.due');
    } else if (!isList) {
        message += t('note.header.saved');
    }

    const statusText = note.status === 'notified' ? t('note.already_notified') : '';
    const safeTask = escapeMarkdown(note.task);
    const actionVerb = note.status === 'notified' && !isNotification ? safeTask : `*${safeTask}*`;

    message += `${actionVerb}${statusText}. `;

    if (date) {
        const deadlineFormatted = format(date, DATE_FORMAT);
        if (note.status === 'notified') {
            message += t('note.was_due', { date: deadlineFormatted });
        } else {
            message += t('note.deadline', { date: deadlineFormatted });
        }
    }

    if (note.recurrence) {
        const key = `recurrence.${note.recurrence}`;
        const label = t(key);
        if (label !== key) {
            message += t('note.recurrence', { label });
        }
    }

    const keyboardRows = [];

    if (note.localPath) {
        keyboardRows.push([
            { text: t('note.btn.attachment'), callback_data: `VIEWFILE_NOTE_${note.id}` }
        ]);
    }

    keyboardRows.push([
        { text: t('note.btn.done'), callback_data: `DONE_NOTE_${note.id}` },
        { text: t('note.btn.delete'), callback_data: `DELETE_NOTE_${note.id}` }
    ]);

    return { text: message, markup: { inline_keyboard: keyboardRows } };
}
