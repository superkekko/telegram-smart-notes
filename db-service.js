import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { formatIsoNow, calculateNextOccurrence, deleteLocalFile } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The database is stored in the /data folder
const DB_PATH = path.join(__dirname, 'data', 'notes.db');
let db;

/*
 * Opens the database connection and creates the required tables
 */
export async function initializeDb() {
    try {
        db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });

        // 1. Notes / reminders
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

        // 2. Web login codes
        await db.exec(`
            CREATE TABLE IF NOT EXISTS auth_codes (
                chatId TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                expiresAt INTEGER NOT NULL
            );
        `);

        // 3. Authorized users
        await db.exec(`
            CREATE TABLE IF NOT EXISTS authorized_users (
                chatId TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT,
                createdAt TEXT NOT NULL
            );
        `);

        // 4. Web dashboard sessions
        await db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                chatId TEXT NOT NULL,
                expiresAt INTEGER NOT NULL
            );
        `);

        console.log("✅ Database tables verified and ready.");
    } catch (error) {
        console.error("❌ Error while initializing the DB:", error);
        throw error;
    }
}

/*
 * NOTES / REMINDERS
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
        // Recurring note: compute the next date and set the status back to 'active'
        const nextDeadline = calculateNextOccurrence(note.deadline || formatIsoNow(), note.recurrence);
        const result = await db.run(
            `UPDATE notes SET deadline = ?, status = 'active' WHERE id = ? AND chatId = ?`,
            [nextDeadline, id, String(chatId)]
        );
        return result.changes > 0;
    } else {
        // Otherwise mark it as completed and delete the local file, if any
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
 * USERS AND AUTHORIZATION
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
 * AUTHENTICATION AND SESSIONS (WEB DASHBOARD)
 */

export async function saveAuthCode(chatId, code) {
    if (!db) await initializeDb();
    const expiresAt = Date.now() + 5 * 60 * 1000; // Valid for 5 minutes
    return await db.run(
        `INSERT OR REPLACE INTO auth_codes (chatId, code, expiresAt) VALUES (?, ?, ?)`,
        [String(chatId), code, expiresAt]
    );
}

// Verifies the 6-digit code generated by /login and, if valid, consumes it.
export async function verifyAuthCode(chatId, code) {
    if (!db) await initializeDb();
    const now = Date.now();
    const record = await db.get(
        `SELECT * FROM auth_codes WHERE chatId = ? AND code = ? AND expiresAt > ?`,
        [String(chatId), String(code), now]
    );
    if (!record) return false;

    // The code is single-use: remove it right after verification
    await db.run(`DELETE FROM auth_codes WHERE chatId = ?`, [String(chatId)]);
    return true;
}

export async function createSession(chatId) {
    if (!db) await initializeDb();
    const token = crypto.randomUUID();

    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // Valid for 7 days
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
 * SYSTEM STATISTICS (/stats)
 */
export async function getSystemStats() {
    if (!db) await initializeDb();

    const notesCount = await db.get(`SELECT COUNT(*) as count FROM notes`);
    const usersCount = await db.get(`SELECT COUNT(*) as count FROM authorized_users`);

    let dbSizeMb = 0;
    try {
        const stats = fs.statSync(DB_PATH);
        dbSizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    } catch (e) {
        console.warn("Unable to read the DB file size.");
    }

    return {
        notes: notesCount?.count || 0,
        users: usersCount?.count || 0,
        dbSize: dbSizeMb
    };
}
