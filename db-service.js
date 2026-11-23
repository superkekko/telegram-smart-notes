import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { formatIsoNow, calculateNextOccurrence, deleteLocalFile } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Il database verrà salvato nella cartella /data
const DB_PATH = path.join(__dirname, 'data', 'notes.db');
let db;

/*
 * Inizializza la connessione al database e crea solo le tabelle necessarie
 */
export async function initializeDb() {
    try {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // 1. Tabella Note / Promemoria
        await db.exec(`
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chatId TEXT NOT NULL,
                task TEXT NOT NULL,
                deadline TEXT,
                status TEXT NOT NULL, -- 'active', 'notified', 'completed'
                recurrence TEXT,
                fileId TEXT,
                localPath TEXT,
                createdAt TEXT NOT NULL
            );
        `);

        // 2. Tabella Codici di Autenticazione Web
        await db.exec(`
            CREATE TABLE IF NOT EXISTS auth_codes (
                chatId TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                expiresAt INTEGER NOT NULL
            );
        `);

        // 3. Tabella Utenti Autorizzati
        await db.exec(`
            CREATE TABLE IF NOT EXISTS authorized_users (
                chatId TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT,
                createdAt TEXT NOT NULL
            );
        `);

        // 4. Tabella Sessioni Web Dashboard
        await db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                chatId TEXT NOT NULL,
                expiresAt INTEGER NOT NULL
            );
        `);

        console.log("✅ Tabelle del database verificate e pronte.");
    } catch (error) {
        console.error("❌ Errore durante l'inizializzazione del DB:", error);
        throw error;
    }
}

/*
 * GESTIONE NOTE / PROMEMORIA
 */

export async function saveNote(chatId, classification, fileData = {}) {
    if (!db) await initializeDb();
    const now = formatIsoNow();

    const result = await db.run(
        `INSERT INTO notes (chatId, task, deadline, status, recurrence, fileId, localPath, createdAt) 
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
        [
            String(chatId),
            classification.task,
            classification.deadline || null,
            classification.recurrence || null,
            fileData.fileId || null,
            fileData.localPath || null,
            now
        ]
    );
    return result.lastID;
}

export async function getNotes(chatId, statuses = ['active']) {
    if (!db) await initializeDb();
    const placeholders = statuses.map(() => '?').join(',');
    return await db.all(
        `SELECT * FROM notes WHERE chatId = ? AND status IN (${placeholders}) ORDER BY deadline ASC, createdAt DESC`,
        [String(chatId), ...statuses]
    );
}

export async function getNoteById(id, chatId) {
    if (!db) await initializeDb();
    return await db.get(
        `SELECT * FROM notes WHERE id = ? AND chatId = ?`,
        [id, String(chatId)]
    );
}

export async function completeNote(id, chatId) {
    if (!db) await initializeDb();
    const note = await getNoteById(id, chatId);
    if (!note) return false;

    if (note.recurrence) {
        // Se è ricorrente, calcola la prossima data e reimposta lo stato su 'active'
        const nextDeadline = calculateNextOccurrence(note.deadline || formatIsoNow(), note.recurrence);
        const result = await db.run(
            `UPDATE notes SET deadline = ?, status = 'active' WHERE id = ? AND chatId = ?`,
            [nextDeadline, id, String(chatId)]
        );
        return result.changes > 0;
    } else {
        // Altrimenti la marca semplicemente come completata ed elimina il file locale se presente
        if (note.localPath) {
            deleteLocalFile(note.localPath);
        }
        const result = await db.run(
            `UPDATE notes SET status = 'completed', localPath = NULL WHERE id = ? AND chatId = ?`,
            [id, String(chatId)]
        );
        return result.changes > 0;
    }
}

export async function deleteNote(id, chatId) {
    if (!db) await initializeDb();
    const note = await getNoteById(id, chatId);
    if (note && note.localPath) {
        deleteLocalFile(note.localPath);
    }
    const result = await db.run(
        `DELETE FROM notes WHERE id = ? AND chatId = ?`,
        [id, String(chatId)]
    );
    return result.changes > 0;
}

export async function getExpiredNotes() {
    if (!db) await initializeDb();
    const now = formatIsoNow();
    return await db.all(
        `SELECT id, chatId, task, deadline, status FROM notes 
         WHERE deadline IS NOT NULL 
         AND deadline < ? 
         AND status = 'active'`,
        [now]
    );
}

export async function getUncompletedExpiredNotes() {
    if (!db) await initializeDb();
    const now = formatIsoNow();
    return await db.all(
        `SELECT id, chatId, task, deadline, status FROM notes 
         WHERE deadline IS NOT NULL 
         AND deadline < ? 
         AND status IN ('active', 'notified')`,
        [now]
    );
}

export async function markNoteAsNotified(id) {
    if (!db) await initializeDb();
    const result = await db.run(
        `UPDATE notes SET status = 'notified' WHERE id = ? AND status = 'active'`,
        [id]
    );
    return result.changes > 0;
}

/*
 * GESTIONE UTENTI E AUTORIZZAZIONI
 */

export async function isUserInDb(chatId) {
    if (!db) await initializeDb();
    return await db.get(`SELECT * FROM authorized_users WHERE chatId = ?`, [String(chatId)]);
}

export async function addAuthorizedUser(chatId, name, username = null) {
    if (!db) await initializeDb();
    const now = formatIsoNow();
    return await db.run(
        `INSERT OR REPLACE INTO authorized_users (chatId, name, username, createdAt) VALUES (?, ?, ?, ?)`,
        [String(chatId), name, username, now]
    );
}

/*
 * UTILITY AUTENTICAZIONE E SESSIONI (WEB DASHBOARD)
 */

export async function saveAuthCode(chatId, code) {
    if (!db) await initializeDb();
    const expiresAt = Date.now() + 5 * 60 * 1000; // Valido 5 minuti
    return await db.run(
        `INSERT OR REPLACE INTO auth_codes (chatId, code, expiresAt) VALUES (?, ?, ?)`,
        [String(chatId), code, expiresAt]
    );
}

// Verifica il codice a 6 cifre generato da /login e, se valido, lo consuma.
export async function verifyAuthCode(chatId, code) {
    if (!db) await initializeDb();
    const now = Date.now();
    const record = await db.get(
        `SELECT * FROM auth_codes WHERE chatId = ? AND code = ? AND expiresAt > ?`,
        [String(chatId), String(code), now]
    );
    if (!record) return false;

    // Il codice è "usa e getta": lo rimuoviamo subito dopo la verifica
    await db.run(`DELETE FROM auth_codes WHERE chatId = ?`, [String(chatId)]);
    return true;
}

export async function createSession(chatId) {
    if (!db) await initializeDb();
    const token = crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).substring(2) + Date.now().toString(36);

    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // Valida 7 giorni
    await db.run(
        `INSERT INTO sessions (token, chatId, expiresAt) VALUES (?, ?, ?)`,
        [token, String(chatId), expiresAt]
    );
    return token;
}

export async function getSession(token) {
    if (!db) await initializeDb();
    if (!token) return null;
    const cleanToken = token.replace('Bearer ', '').trim();
    const now = Date.now();
    return await db.get(
        `SELECT * FROM sessions WHERE token = ? AND expiresAt > ?`,
        [cleanToken, now]
    );
}

/*
 * STATISTICHE DI SISTEMA (/stats)
 */
export async function getSystemStats() {
    if (!db) await initializeDb();

    const notesCount = await db.get(`SELECT COUNT(*) as count FROM notes`);
    const usersCount = await db.get(`SELECT COUNT(*) as count FROM authorized_users`);

    let dbSizeMb = 0;
    try {
        const fs = await import('fs');
        const stats = fs.statSync(DB_PATH);
        dbSizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    } catch (e) {
        console.warn("Impossibile calcolare la dimensione del file DB fisicamente.");
    }

    return {
        notes: notesCount?.count || 0,
        users: usersCount?.count || 0,
        dbSize: dbSizeMb
    };
}
