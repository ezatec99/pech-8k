FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 ffmpeg ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV PORT=10000
EXPOSE 10000
CMD ["node", "server.js"]
