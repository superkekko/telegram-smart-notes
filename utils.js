import { addDays, addWeeks, addMonths, parseISO, format } from 'date-fns';
import fs from 'fs';
import path from 'path';

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
            console.log(`File eliminato con successo: ${filePath}`);
        }
    } catch (err) {
        console.error(`Errore durante l'eliminazione del file ${filePath}:`, err);
    }
}

export function calculateNextOccurrence(currentDeadline, recurrence, includeTime = true) {
    const date = parseISO(currentDeadline.replace(' ', 'T'));
    let nextDate;

    switch (recurrence) {
        case 'daily': nextDate = addDays(date, 1); break;
        case 'weekly': nextDate = addWeeks(date, 1); break;
        case 'monthly': nextDate = addMonths(date, 1); break;
        case 'yearly': nextDate = addDays(date, 365); break; // Modificato per coerenza o usa addYears se importato
        default: return currentDeadline;
    }
	
	return includeTime 
        ? format(nextDate, 'yyyy-MM-dd HH:mm:ss')
        : format(nextDate, 'yyyy-MM-dd');
}

export function formatIsoNow(includeTime = true) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('it-IT', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: 'Europe/Rome',
        hour12: false
    }).formatToParts(now);

    const d = {};
    parts.forEach(({ type, value }) => d[type] = value);

    const hour = d.hour === '24' ? '00' : d.hour;
    const dateStr = `${d.year}-${d.month}-${d.day}`;

    return includeTime 
        ? `${dateStr} ${hour}:${d.minute}:${d.second}` 
        : dateStr;
}

// Esegue l'escaping dei caratteri speciali della sintassi Markdown "legacy" di Telegram
// (quella usata con parse_mode: 'Markdown'), per evitare che testo dinamico (es. il
// contenuto di una nota scritto dall'utente) rompa la formattazione o causi un errore
// nell'invio del messaggio se contiene caratteri come _ * ` [
export function escapeMarkdown(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/([_*`[])/g, '\\$1');
}

export function formatNoteForReply(note, isList = false, isNotification = false) {
    const date = note.deadline ? new Date(note.deadline) : null;
    let message = '';
    
    const recurrenceText = {
        'daily': '(Ogni giorno)',
        'weekly': '(Ogni settimana)',
        'monthly': '(Ogni mese)',
        'yearly': '(Ogni anno)'
    };

    if (isNotification) {
        message += `⏰ *Ehi! Sembra che questo promemoria sia scaduto o stia per scadere*:\n\n`;
    } else if (!isList) {
        message += `✅ *Perfetto, ho memorizzato tutto!* \n\n`;
    }
    
    let statusText = note.status === 'notified' ? ' (già notificato)' : '';
    const safeTask = escapeMarkdown(note.task);
    let actionVerb = note.status === 'notified' && !isNotification ? safeTask : `*${safeTask}*`;
    
    message += `${actionVerb}${statusText}. `;

	if (date) {
        const deadlineFormatted = format(date, 'dd/MM/yyyy HH:mm');
        if (note.status === 'notified') {
             message += `⏳ (Era il: ${deadlineFormatted})`;
        } else {
             message += `📅 Scadenza: ${deadlineFormatted}`;
        }
    }
    
    if (note.recurrence && recurrenceText[note.recurrence]) {
        message += ` 🔄 Ricorrenza: ${recurrenceText[note.recurrence]}`;
    }

    const keyboardRows = [];

    if (note.localPath) {
        keyboardRows.push([
            { text: '📁 Vedi Allegato', callback_data: `VIEWFILE_NOTE_${note.id}` }
        ]);
    }

    keyboardRows.push([
        { text: '✔️ Fatto', callback_data: `DONE_NOTE_${note.id}` },
        { text: '🗑️ Cancella', callback_data: `DELETE_NOTE_${note.id}` }
    ]);

    const keyboard = { inline_keyboard: keyboardRows };
    
    return { text: message, markup: keyboard };
}