# Trading gateway image.
#
# Multi-stage so the runtime image carries no TypeScript, no dev tooling and no
# source: just Node and the compiled JavaScript. The gateway has ZERO runtime
# dependencies, which keeps the image small and the supply chain trivial.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
# Dev dependencies only need to exist at build time (typescript + @types/node).
RUN npm ci --include=dev || npm install --include=dev
COPY src ./src
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# Non-root: a compromised gateway process should not own the filesystem.
RUN addgroup -S gateway && adduser -S gateway -G gateway \
  && mkdir -p /data && chown -R gateway:gateway /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
USER gateway
EXPOSE 8787
# The idempotency journal must live on a persistent volume: it is what stops a
# restarted gateway from resubmitting an order it already sent.
ENV IDEMPOTENCY_STORE=/data/order-ledger.jsonl
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
