# Telegram Smart Notes

🇬🇧 [English version](README.md)

Bot Telegram per promemoria "intelligenti": scrivi un messaggio in linguaggio naturale (es. _"ricordami di chiamare la banca domani alle 15"_) e il bot, tramite Google Gemini, estrae automaticamente compito, scadenza ed eventuale ricorrenza. Include una dashboard web (utilizzabile anche come Telegram Mini App) per gestire i promemoria da browser.

## Funzionalità

- Creazione promemoria da testo libero, con estrazione di scadenza e ricorrenza via Gemini
- Allegati (foto/documenti) collegati ai promemoria
- Notifiche automatiche alla scadenza + riepilogo giornaliero degli scaduti non completati
- Dashboard web con login automatico (Telegram Mini App) o manuale (codice a 6 cifre generato con `/login`)
- Whitelist di chat autorizzate, con un comando `/authorize` per aggiungerne di nuove
- Completamente internazionalizzato: messaggi del bot, dashboard e interpretazione AI funzionano nella lingua scelta (inglese e italiano inclusi), con fuso orario configurabile

## Requisiti

- Docker e Docker Compose
- Un bot Telegram creato tramite [@BotFather](https://t.me/BotFather) → serve il **token**
- Una API key di [Google Gemini](https://aistudio.google.com/apikey)
- Il tuo **chat ID** Telegram (puoi ottenerlo scrivendo a [@userinfobot](https://t.me/userinfobot))

## Avvio rapido

1. Clona il repository ed entra nella cartella.
2. Copia il file di esempio delle variabili d'ambiente:
   ```bash
   cp .env.example .env
   ```
3. Apri `.env` e compila i valori (vedi tabella sotto).
4. Avvia il servizio:
   ```bash
   docker compose up -d --build
   ```
5. Su Telegram, apri una chat col tuo bot e invia `/start`.

## Variabili d'ambiente

| Variabile             | Descrizione                                                                 |
|------------------------|------------------------------------------------------------------------------|
| `GEMINI_API_KEY`       | Chiave API di Google Gemini, usata per classificare le note                  |
| `TELEGRAM_BOT_TOKEN`   | Token del bot, ottenuto da @BotFather                                        |
| `AUTHORIZED_CHAT_IDS`  | Chat ID "Master Admin" separati da virgola; possono usare `/authorize` e `/stats` |
| `DASHBOARD_URL`        | URL pubblico della dashboard, usato nel link generato da `/login`            |
| `WEB_PORT`             | Porta su cui è esposta la dashboard (default `3000`)                         |
| `LANGUAGE`             | Lingua di bot e dashboard: un file in `locales/` (`en`, `it`; default `en`)  |
| `TIMEZONE`             | Fuso IANA per scadenze, notifiche e riepilogo delle 09:00 (default `UTC`, es. `Europe/Rome`) |

## Comandi del bot

| Comando           | Descrizione                                              |
|--------------------|-----------------------------------------------------------|
| `/start`           | Messaggio di benvenuto                                   |
| `/help`            | Elenco comandi                                            |
| `/list`            | Mostra i promemoria attivi                                |
| `/login`           | Genera un codice/link per accedere alla dashboard web     |
| `/authorize <id> [nome]` | *(solo Master Admin)* Autorizza una nuova chat a usare il bot |
| `/stats`           | *(solo Master Admin)* Statistiche di sistema               |

## Lingua e fuso orario

Tutti i testi visibili all'utente sono in `locales/<codice>.json`. Imposta `LANGUAGE` nel `.env` per sceglierne uno (inclusi `en` e `it`); le chiavi mancanti ripiegano sull'inglese. Le note si possono scrivere in **qualsiasi** lingua indipendentemente da `LANGUAGE`: l'AI mantiene il testo del promemoria nella lingua usata.

Per aggiungere una lingua, copia `locales/en.json` in `locales/<codice>.json` (es. `fr.json`), traduci i valori (senza toccare i `{segnaposto}`), aggiorna `_locale` (tag BCP 47, usato per formattare le date) e `_dateFormat` se serve, poi imposta `LANGUAGE=<codice>`.

## Configurazione Mini App Telegram (opzionale)

Per aprire la dashboard dentro Telegram con login automatico, `DASHBOARD_URL` deve essere un URL **HTTPS** pubblico. Poi, con @BotFather: `/mybots` → il tuo bot → **Bot Settings → Menu Button → Configure menu button** e incolla l'URL. Senza questo passaggio `/login` funziona comunque: invia un link e un codice a 6 cifre.

## Persistenza dei dati

Il database SQLite e gli allegati vengono salvati in `/usr/src/app/data` dentro il container. Il `docker-compose.yml` fornito usa un **volume Docker nominato** (`notes-data`) per la persistenza automatica tra i riavvii.

Se preferisci vedere i file direttamente sull'host (es. per fare backup più facilmente), nel `docker-compose.yml` commenta la riga del volume nominato e usa quella con il bind-mount su `./data`, dopo aver creato la cartella localmente.

## Sviluppo locale (senza Docker)

```bash
npm install
cp .env.example .env   # e compila i valori
npm run dev             # usa nodemon per il reload automatico
```

## Note di sicurezza

- **Non committare mai** il file `.env` né la cartella `data/` (contengono segreti e dati reali): sono già esclusi da `.gitignore`.
- Solo le chat presenti in `AUTHORIZED_CHAT_IDS` (o autorizzate via `/authorize`) possono usare il bot.
- Se in passato hai condiviso pubblicamente un token del bot o una API key, **rigenerali** (BotFather → `/revoke`, Google AI Studio → elimina/ricrea la chiave): un vecchio segreto esposto va considerato compromesso anche se poi rimosso dal codice.
- Il testo delle note viene "escapato" come HTML nella dashboard, quindi una nota malevola non può iniettare script.
- Il testo delle note viene automaticamente "escapato" prima di essere inserito nei messaggi Telegram con `parse_mode: Markdown`, così caratteri come `_ * \` [` nel contenuto di una nota non rompono più la formattazione.
- L'autenticazione della Telegram Mini App (`verifyTmaData`) ora rifiuta un `initData` più vecchio di 24 ore (costante `TMA_MAX_AGE_SECONDS` in `web-server.js`), oltre a validarne la firma. Puoi accorciare questa finestra se esponi la dashboard pubblicamente.

## Limiti noti / possibili miglioramenti futuri

- Non è presente un file di licenza: se il repository sarà pubblico, valuta di aggiungerne uno (es. MIT).
