FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production
COPY server.js db.js ./
VOLUME ["/data"]
EXPOSE 3010
CMD ["node", "server.js"]
