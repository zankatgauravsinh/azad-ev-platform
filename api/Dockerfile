# Multi-stage build for the AZAD EV POINT API.
# Build context is the monorepo root (app/), so shared + api build together:
#   docker build -f api/Dockerfile -t azad-ev-api .
# NOTE: reviewed for correctness against the workspace layout; build it in your
# CI/host before first deploy (this repo's dev box has no Docker daemon).

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /repo
# Install deps against the workspace manifests (better layer caching).
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci
# Build the shared contracts, then the API, then the Prisma client.
COPY packages/shared packages/shared
RUN npm run build --workspace @azad/shared
COPY api api
RUN npx prisma generate --schema api/prisma/schema.prisma \
 && npm run build --workspace api
# Drop dev deps for a lean runtime. The `prisma` CLI is a runtime dependency
# (not a devDependency), so it survives this prune and the boot-time
# `prisma migrate deploy` below can run.
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN apk add --no-cache postgresql-client   # for scripts/backup.sh
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/api/dist ./api/dist
COPY --from=build /repo/api/package.json ./api/package.json
COPY api/prisma ./api/prisma
COPY scripts ./scripts
EXPOSE 3000
# Apply migrations, then boot. (Run migrations as a separate job in HA setups.)
CMD ["sh", "-c", "npx prisma migrate deploy --schema api/prisma/schema.prisma && node api/dist/main.js"]
