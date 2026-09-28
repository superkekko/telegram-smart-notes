import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, 'locales');
const DEFAULT_LANGUAGE = 'en';

// Loads locales/<code>.json. Returns null if the code is malformed or the file does not exist.
function loadLocale(code) {
    if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(code)) return null;
    const file = path.join(LOCALES_DIR, `${code}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const fallback = loadLocale(DEFAULT_LANGUAGE);
const requested = (process.env.LANGUAGE || DEFAULT_LANGUAGE).trim().toLowerCase();
const selected = loadLocale(requested);

if (!selected) {
    console.warn(`⚠️ Language "${requested}" not found in /locales, falling back to "${DEFAULT_LANGUAGE}".`);
}

// Missing keys in the selected language fall back to English
const strings = { ...fallback, ...(selected || {}) };

export const LANGUAGE = selected ? requested : DEFAULT_LANGUAGE;
export const LOCALE_TAG = strings._locale || 'en-GB';
export const DATE_FORMAT = strings._dateFormat || 'dd/MM/yyyy HH:mm';

// Timezone used for deadlines, the scheduler and the AI prompt (IANA name, e.g. "Europe/Rome")
function resolveTimezone(tz) {
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: tz });
        return tz;
    } catch {
        console.warn(`⚠️ Invalid TIMEZONE "${tz}", falling back to "UTC".`);
        return 'UTC';
    }
}
export const TIMEZONE = resolveTimezone((process.env.TIMEZONE || 'UTC').trim());

// Translates a key, replacing {placeholders} with the given params.
export function t(key, params = {}) {
    const template = strings[key];
    if (template === undefined) return key;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
        params[name] !== undefined ? String(params[name]) : match
    );
}

// Subset of strings exposed to the web dashboard (GET /api/locale)
export function getClientConfig() {
    const clientStrings = {};
    for (const [key, value] of Object.entries(strings)) {
        if (key.startsWith('web.') || key.startsWith('recurrence.')) {
            clientStrings[key] = value;
        }
    }
    return {
        language: LANGUAGE,
        locale: LOCALE_TAG,
        timezone: TIMEZONE,
        strings: clientStrings
    };
}
