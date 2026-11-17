# syntax=docker/dockerfile:1.7
# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS build
# community (default) or enterprise. Enterprise images must contain the paid build (apps/api/src/ee).
ARG EDITION=community
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @yaropay/core --workspace @yaropay/api --include-workspace-root --ignore-scripts
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build -w @yaropay/core && npm run build -w @yaropay/api
RUN if [ "$EDITION" != "community" ] && [ ! -f apps/api/dist/ee/index.js ]; then \
      echo "EDITION=$EDITION, but the paid build (apps/api/src/ee) is missing" >&2; exit 1; \
    fi

FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @yaropay/core --workspace @yaropay/api --omit=dev --ignore-scripts

FROM node:24-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
WORKDIR /app/apps/api
RUN mkdir -p .data && chown node:node .data
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
