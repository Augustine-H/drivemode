FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs ledger.mjs ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV GOOGLE_TTS_HOST=0.0.0.0 GOOGLE_TTS_PORT=8092 GOOGLE_TTS_DATA_DIR=/data
EXPOSE 8092
CMD ["node", "server.mjs"]
