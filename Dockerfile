FROM node:24.15.0-bookworm-slim AS base

# Official registries by default; override for restricted networks (see
# docs/docker-troubleshooting.md), e.g.:
#   --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
#   --build-arg DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian \
#   --build-arg DEBIAN_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG DEBIAN_MIRROR=
ARG DEBIAN_SECURITY_MIRROR=

RUN ( [ -z "$DEBIAN_MIRROR" ] || sed -i -e "s|^URIs: http://deb.debian.org/debian$|URIs: ${DEBIAN_MIRROR}|" \
         -e "s|^URIs: https://deb.debian.org/debian$|URIs: ${DEBIAN_MIRROR}|" \
         /etc/apt/sources.list.d/debian.sources ) \
    && ( [ -z "$DEBIAN_SECURITY_MIRROR" ] || sed -i -e "s|^URIs: http://deb.debian.org/debian-security$|URIs: ${DEBIAN_SECURITY_MIRROR}|" \
         -e "s|^URIs: http://security.debian.org/debian-security$|URIs: ${DEBIAN_SECURITY_MIRROR}|" \
         /etc/apt/sources.list.d/debian.sources ) \
    && printf 'Acquire::Retries "5";\nAcquire::http::Timeout "60";\nAcquire::https::Timeout "60";\n' > /etc/apt/apt.conf.d/80-retries

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
RUN npm config set registry $NPM_REGISTRY \
  && pnpm config set registry $NPM_REGISTRY \
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
COPY packages/authz/package.json packages/authz/
COPY packages/exam-engine/package.json packages/exam-engine/
COPY packages/import-export/package.json packages/import-export/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --reporter=append-only

COPY packages/ packages/
COPY apps/ apps/

RUN pnpm --reporter=append-only --filter @exam/domain build
RUN pnpm --reporter=append-only --filter @exam/contracts build
RUN pnpm --reporter=append-only --filter @exam/auth build
RUN pnpm --reporter=append-only --filter @exam/authz build
RUN pnpm --reporter=append-only --filter @exam/import-export build
RUN pnpm --reporter=append-only --filter @exam/db build
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
# No SPA bundle here (#585): the API image is API-only. The built web
# frontend ships in the web-runner image above and is served by the `web`
# service behind nginx — the API must never become a second, shadowing SPA
# origin.
COPY docker-entrypoint.sh ./

RUN chmod +x /app/docker-entrypoint.sh

USER appuser

EXPOSE 3000

ENV APP_PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV APP_MODE=production

ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Production Web runtime (#585): nginx serving the built SPA on :4173 — a
# separate service from the API runner above. The canonical production
# ingress (deploy/nginx/edge.conf) routes / -> web:4173 and /api/** ->
# app:3000. The web config is BAKED in here; the edge config is
# runtime-mounted by docker-compose.yml. INVARIANT: every build of the API
# image (tests/deployment/lib.sh, release.yml) pins `target: runner`
# explicitly — a targetless build would select this final stage and ship
# nginx as the API.
FROM nginx:1.30.5-alpine3.24 AS web-runner

COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 4173
