FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY *.mjs ./

USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
