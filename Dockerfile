FROM node:lts-alpine AS base

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/exam-engine/package.json packages/exam-engine/
COPY packages/import-export/package.json packages/import-export/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/web/ apps/web/
COPY apps/api/ apps/api/

RUN pnpm --filter @exam/web build

RUN pnpm --filter @exam/api build

FROM node:lts-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN addgroup --system --gid 1001 appgroup && adduser --system --uid 1001 appuser
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/exam-engine/package.json packages/exam-engine/
COPY packages/import-export/package.json packages/import-export/
COPY apps/api/package.json apps/api/

ENV NODE_ENV=production
RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/apps/api/dist apps/api/dist/
COPY --from=base /app/apps/web/dist apps/api/public/
COPY --from=base /app/packages/db/src/migrations packages/db/src/migrations/
COPY --from=base /app/packages/db/src/schema packages/db/src/schema/
COPY --from=base /app/packages/db/drizzle packages/db/
COPY --from=base /app/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER appuser

EXPOSE 3000

ENV APP_PORT=3000
ENV HOST=0.0.0.0

ENTRYPOINT ["/app/docker-entrypoint.sh"]
