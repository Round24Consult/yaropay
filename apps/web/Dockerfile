# syntax=docker/dockerfile:1.7
# Build from the repository root: docker build -f apps/web/Dockerfile --build-arg YAROPAY_API_URL=http://api:4000 .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @yaropay/core --workspace @yaropay/web --include-workspace-root --ignore-scripts
COPY packages/core packages/core
COPY apps/web apps/web
# The dashboard proxies /api and /v1 to the API. Next compiles rewrites at build time.
ARG YAROPAY_API_URL=http://api:4000
ENV YAROPAY_API_URL=$YAROPAY_API_URL NEXT_TELEMETRY_DISABLED=1 YAROPAY_STANDALONE=1
RUN npm run build -w @yaropay/web

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
