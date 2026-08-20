# Docker Troubleshooting

## China mainland network issues

The image and image build default to official upstreams (Docker Hub,
`registry.npmjs.org`, `deb.debian.org`). If any of those are unreachable from
your network, override them per step below. None of these are baked into the
default configuration.

### 1. Docker Hub image pulls are slow or fail

The `docker build` base image (`node:...`) and `postgres:18.4-bookworm` come
from Docker Hub. Configure a registry mirror at the Docker daemon level
(`/etc/docker/daemon.json` on Linux, or Docker Desktop → Settings → Docker
Engine):

```json
{
  "registry-mirrors": ["https://docker.m.daocloud.io"]
}
```

Then restart Docker and pull again. Choose any accessible mirror for your
region (e.g. DaoCloud, Aliyun ACR, Tencent Cloud, USTC, NetEase). This is a
daemon setting, not part of the project.

### 2. `npm install` fails during the image build

The build downloads packages from `registry.npmjs.org` by default. Override
with a China registry (e.g. npmmirror):

```bash
docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com
```

### 3. `apt-get` fails during the image build

The build installs `ca-certificates` (base) and `python3 make g++`
(builder) from `deb.debian.org` by default. Override with a China Debian
mirror:

```bash
docker compose build \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian \
  --build-arg DEBIAN_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
```

`DEBIAN_MIRROR` must be the mirror's Debian repo URL (the value that replaces
`http://deb.debian.org/debian`), and `DEBIAN_SECURITY_MIRROR` likewise for
the security repo.

## Common issues

### Port 3000 already in use

The stack maps `${EXAM_PORT:-3000}`. Change the host port in `.env.deploy`:

```dotenv
EXAM_PORT=3001
```
(docker compose --env-file .env.deploy ...)

### The stack is up but the page does not load

Verify instead of guessing:

```bash
docker compose ps          # all services running, app healthy
docker compose logs app    # migrations + 'Server listening'?
curl -i http://localhost:3000/          # expect 200 + text/html
curl -I http://localhost:3000/assets/   # expect 200 for a built asset
```

The app healthcheck already requires both the API (`/api/health`) and the SPA
(`/` returning HTML) to respond, so `app: healthy` means the web app is being
served. If the browser still cannot reach it, check that the container's
published port is reachable from the host (firewall / WSL2 localhost
forwarding on Windows).

### Windows / WSL2 notes

- Run the Quick Start from inside WSL2 (Ubuntu). `docker compose up -d` works
  from PowerShell too, but `node scripts/generate-env.mjs` needs Node on the
  host PATH.
- On Windows, Docker Desktop usually exposes `localhost:3000` to the host
  automatically. If not, access the container via the WSL2 IP
  (`ip addr show eth0 | grep inet` inside WSL) or run the browser inside WSL.
