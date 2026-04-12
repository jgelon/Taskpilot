FROM node:20-alpine
# wget is not always present in alpine — use node for the healthcheck instead
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production
COPY server.js db.js gamification.js ./
VOLUME ["/data"]
EXPOSE 3010
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3010/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "server.js"]
