# Dockerfile for this repo's local fork of bmurdock/scryfall-mcp
# (https://github.com/bmurdock/scryfall-mcp, vendored at fd585a0, MIT licensed
# -- see LICENSE and README.md for what's been changed since).
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./

# Upstream package-lock.json can drift from package.json; npm install resolves
# dependencies cleanly instead of requiring an exact lock match.
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npx tsc

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "dotenv/config", "dist/http.js"]
