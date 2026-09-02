# Dockerfile for bmurdock/scryfall-mcp (https://github.com/bmurdock/scryfall-mcp).
# Built directly from the upstream GitHub repository.
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && git config --global http.version HTTP/1.1 \
    && rm -rf /var/lib/apt/lists/*

ARG SCRYFALL_MCP_REPO=https://github.com/bmurdock/scryfall-mcp.git
ARG SCRYFALL_MCP_REF=main

RUN git -c http.version=HTTP/1.1 clone --depth 1 --branch ${SCRYFALL_MCP_REF} ${SCRYFALL_MCP_REPO} .

# Upstream package-lock.json can drift from package.json; npm install resolves
# dependencies cleanly instead of requiring an exact lock match.
RUN npm install

# Compile TypeScript to dist/
RUN npx tsc

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "--import", "dotenv/config", "dist/http.js"]
