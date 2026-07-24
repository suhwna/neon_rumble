FROM node:24-bookworm-slim

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production
ENV PORT=4173
ENV NEON_DB_PATH=/app/data/neon-rumble.sqlite

USER node

EXPOSE 4173

CMD ["node", "server.js"]
