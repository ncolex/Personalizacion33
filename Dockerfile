FROM node:20-alpine AS base

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY data ./data

ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
