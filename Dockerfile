# Life Hub: single container serving the PWA, /api/v1 (PORT) and /mcp (MCP_PORT).
# Keep the Node major in sync with .nvmrc and CI.
FROM node:26.13.1-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:26.13.1-trixie-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MCP_PORT=3001 \
    DATA_DIR=/data \
    WEB_DIR=/app/dist/web \
    TZ=Europe/Zurich
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Runs as the image's non-root "node" user (UID/GID 1000). /data must be writable by it.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server/server.js"]
