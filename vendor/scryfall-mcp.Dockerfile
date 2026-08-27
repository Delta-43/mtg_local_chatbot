# Dockerfile for bmurdock/scryfall-mcp (https://github.com/bmurdock/scryfall-mcp).
# Kept outside the vendor/scryfall-mcp/ submodule (which ships no Dockerfile of its
# own) so it survives `git submodule update`. Build context is vendor/scryfall-mcp/.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
# npm ci fails here: upstream's package-lock.json is out of sync with
# package.json (esbuild resolves to 0.28.2 via tsx, lock only has 0.25.5).
# npm install re-resolves instead of requiring an exact lock match.
RUN npm install

COPY . .
# Compile only -- upstream's "build" npm script also runs the full test suite
# (tsc && npm run test), which is unnecessary and network/env-fragile at image
# build time.
RUN npx tsc

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "dotenv/config", "dist/http.js"]
