FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY sync-server ./sync-server
COPY sync ./sync
ENV PORT=8787 DATA_FILE=/data/data.json
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "sync-server/index.js"]
