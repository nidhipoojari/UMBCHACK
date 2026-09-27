# Playwright's image ships Chromium and the system libraries it needs; the
# playwright package version must match the image tag.
FROM mcr.microsoft.com/playwright:v1.56.0-noble

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY *.mjs ./

# The browser opens URLs from job postings, so it does not run as root.
USER pwuser

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
