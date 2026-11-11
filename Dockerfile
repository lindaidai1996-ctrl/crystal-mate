# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG DEBIAN_MIRROR=deb.debian.org
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::http::Timeout=30 update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM dependencies AS migration
COPY deploy/inspect-db.mjs ./deploy/inspect-db.mjs
ENTRYPOINT ["./node_modules/.bin/prisma"]
CMD ["migrate", "deploy"]

FROM dependencies AS builder
COPY . .
ENV DOCKER_STANDALONE=1
# Build with placeholders, never production credentials or a reachable production DB.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    DIRECT_URL=postgresql://build:build@127.0.0.1:5432/build \
    AUTH_SECRET=build-only-placeholder-not-used-at-runtime \
    npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client
RUN mkdir -p /app/.cache/images && chown -R node:node /app/.cache
USER node
EXPOSE 3000
CMD ["node", "server.js"]
