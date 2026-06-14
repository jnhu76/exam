FROM node:24.15.0-bookworm-slim AS base

RUN sed -i \
  -e 's|^URIs: http://deb.debian.org/debian$|URIs: http://mirrors.tuna.tsinghua.edu.cn/debian|' \
  -e 's|^URIs: https://deb.debian.org/debian$|URIs: https://mirrors.tuna.tsinghua.edu.cn/debian|' \
  -e 's|^URIs: http://deb.debian.org/debian-security$|URIs: http://security.debian.org/debian-security|' \
  -e 's|^URIs: http://security.debian.org/debian-security$|URIs: http://security.debian.org/debian-security|' \
  /etc/apt/sources.list.d/debian.sources \
  && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "60";\nAcquire::https::Timeout "60";\n' > /etc/apt/apt.conf.d/80-retries

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
RUN npm config set registry https://registry.npmmirror.com \
  && pnpm config set registry https://registry.npmmirror.com \
  && npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 20000 \
  && npm config set fetch-retry-maxtimeout 120000 \
  && npm config set fetch-timeout 600000

FROM base AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/exam-engine/package.json packages/exam-engine/
COPY packages/import-export/package.json packages/import-export/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --reporter=append-only

COPY packages/ packages/
COPY apps/ apps/

RUN pnpm --reporter=append-only --filter @exam/domain build
RUN pnpm --reporter=append-only --filter @exam/contracts build
RUN pnpm --reporter=append-only --filter @exam/import-export build
RUN pnpm --reporter=append-only --filter @exam/db build
RUN pnpm --reporter=append-only --filter @exam/auth build
RUN pnpm --reporter=append-only --filter @exam/exam-engine build
RUN pnpm --reporter=append-only --filter @exam/web build
RUN pnpm --reporter=append-only --filter @exam/api build
RUN pnpm --reporter=append-only --filter @exam/api --prod deploy --legacy /out


FROM base AS runner

RUN groupadd --gid 1001 appgroup \
  && useradd --uid 1001 --gid appgroup appuser

RUN mkdir -p /app/data && chown -R appuser:appgroup /app

WORKDIR /app

COPY --from=builder /out/ ./
COPY --from=builder /app/apps/web/dist ./public/
COPY docker-entrypoint.sh ./

RUN chmod +x /app/docker-entrypoint.sh

USER appuser

EXPOSE 3000

ENV APP_PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV APP_MODE=production

ENTRYPOINT ["/app/docker-entrypoint.sh"]
