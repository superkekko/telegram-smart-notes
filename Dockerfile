# Node.js base image
FROM node:20-slim

WORKDIR /usr/src/app

# Install only the package files first to take advantage of Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Create the data folder (in production it is normally replaced by a mounted volume)
RUN mkdir -p data/attachments

EXPOSE 3000

CMD ["node", "index.js"]
