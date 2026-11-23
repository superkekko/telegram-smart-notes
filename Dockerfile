# Immagine base Node.js
FROM node:20-slim

WORKDIR /usr/src/app

# Installa prima solo i file dei pacchetti per sfruttare la cache dei layer Docker
COPY package*.json ./
RUN npm install --omit=dev

# Copia il resto del codice dell'applicazione
COPY . .

# Crea la cartella dati (verrà comunque sovrascritta da un volume in produzione)
RUN mkdir -p data/attachments

EXPOSE 3000

CMD ["node", "index.js"]
