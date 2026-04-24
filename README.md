# ⛏️ Bitcoin Core Terminal

Local **Bitcoin Core regtest** environment using Docker Compose, including:

- `bitcoind` (regtest) with data persisted in a named volume, plus a
  container-side healthcheck so dependent services only start once the node is
  actually responsive.
- Web terminal (FastAPI + HTML/CSS/JS) with snippets, draggable splits,
  language switcher (English / Portuguese) and terminal-like UX.
- Proxy (nginx) exposing only the UI on the host, with security headers and
  cache-busting for dev.

## Prerequisites

- Docker Engine + Docker Compose (plugin `docker compose`)

Verify:

```bash
docker --version
docker compose version
```

## Configuration (.env)

Copy the template before the first run (the `.env` file is gitignored on
purpose — it holds credentials):

```bash
cp .env_template .env
```

Configuration keys:

- `HOST_PORT` (host port published by the nginx proxy)
- `BITCOIN_REPO` and `BITCOIN_VERSION` (Bitcoin Core image — also used as a
  build stage to copy `bitcoin-cli` into the WebUI image)
- `PYTHON_IMAGE` (Python base image for the WebUI container)
- `NGINX_IMAGE` (nginx image used by the reverse proxy)
- `VERSION` (software version shown at the top of the WebUI)
- `BITCOIND_HOST`, `BITCOIND_PORT`, `BITCOIND_USER`, `BITCOIND_PASS`
  (RPC endpoint and credentials used by the WebUI)

Example:

```ini
HOST_PORT=8080
BITCOIN_REPO=bitcoin/bitcoin
BITCOIN_VERSION=30.0
PYTHON_IMAGE=python:3.14-slim
NGINX_IMAGE=nginx:1.30-alpine
VERSION=0.1.0
BITCOIND_HOST=bitcoind
BITCOIND_PORT=18443
BITCOIND_USER=bitcoin
BITCOIND_PASS=bitcoin
```

To upgrade Bitcoin Core later (e.g. 31.0), change only:

```ini
BITCOIN_VERSION=31.0
```

> If you change `BITCOIND_USER` / `BITCOIND_PASS` in `.env`, also update
> `rpcuser` / `rpcpassword` in [`bitcoind/bitcoin.conf`](bitcoind/bitcoin.conf)
> to match. The WebUI container regenerates its own
> `~/.bitcoin/bitcoin.conf` on start from the same `.env`, via
> [`infra/entrypoint.sh`](infra/entrypoint.sh), so that side stays in sync
> automatically.

## Start the stack

From the project root:

```bash
docker compose up -d --build
```

Open:

```text
http://localhost:8080
```

The WebUI waits for `bitcoind` to become healthy (`getblockchaininfo` returns)
before it starts, and nginx waits for the WebUI. If you see `502 Bad Gateway`
right after startup, it just means the proxy came up a moment before the
backend — give it a couple of seconds and reload.

## Smoke test

Using `bitcoin-cli` from the `bitcoind` container:

```bash
docker compose exec --user bitcoin bitcoind bitcoin-cli -regtest getblockchaininfo
```

Using `bitcoin-cli` from inside the WebUI container (the sandbox used by the
Web Terminal's shell commands):

```bash
docker compose exec webui bitcoin-cli getblockchaininfo
```

Using the WebUI HTTP API:

```bash
curl http://localhost:8080/api/health
```

Versions (software/Python/Bitcoin):

```bash
curl http://localhost:8080/api/meta
```

## Using bitcoin-cli

`bitcoin-cli` is already installed inside both the `bitcoind` and `webui`
containers (no need to install it on the host). From the `bitcoind` container:

```bash
docker compose exec --user bitcoin bitcoind bitcoin-cli -regtest getblockcount
```

Optional: alias (run from the project directory):

```bash
alias bitcoin-cli='docker compose exec -T --user bitcoin bitcoind bitcoin-cli'
```

## Web Terminal

The browser terminal accepts `bitcoin-cli`-style commands (with automatic type
parsing) and a small subset of shell for ergonomics (pipes to `jq`, `grep`,
`less`, etc.). It includes:

- Splits and draggable dividers (multiple panes, created/closed at will).
- Per-pane history (`↑`/`↓`), clear with `Ctrl+L`, and the `clear` command.
- Snippets by section, with search (and highlighted matches), collapse/expand,
  and a resizable sidebar.
- Snippet-based autocomplete (`Tab` and `→` complete).
- Multi-line paste support for long commands.
- Distinct rendering for stdout vs. stderr.
- Language switcher (English / Portuguese) in the top bar.
- Useful flags:
  - `-rpcwallet=NAME` (wallet per call)
  - `-generate N` (shortcut to mine on regtest)

## HTTP API

- `GET  /api/health` — round-trips `getblockchaininfo` through bitcoind.
- `GET  /api/meta` — WebUI / Python / Bitcoin Core versions.
- `GET  /api/wallets` — loaded wallets (shortcut for `listwallets`).
- `POST /api/rpc` — JSON-RPC proxy. Body: `{method, params, wallet?}`.
- `POST /api/exec` — runs a shell command inside the WebUI sandbox. Body:
  `{command, cwd?, timeout?}`. Output capped at ~1 MiB, default timeout 30 s
  (max 120 s). The process runs in its own process group and the whole tree
  is killed on timeout.
- OpenAPI docs are served at `/api` (Swagger UI).

Inputs are size-limited at the Pydantic layer to stop accidental abuse.

## Project structure

- [backend/](backend/) (FastAPI)
  - [backend/app.py](backend/app.py) — RPC proxy, sandbox exec, lifespan-managed httpx client
  - [backend/requirements.txt](backend/requirements.txt)
- [webui/static/](webui/static/) (frontend)
  - [webui/static/index.html](webui/static/index.html)
  - [webui/static/app.css](webui/static/app.css)
  - [webui/static/app.js](webui/static/app.js)
  - [webui/static/snippets.html](webui/static/snippets.html)
  - [webui/static/i18n/en-GB.json](webui/static/i18n/en-GB.json)
  - [webui/static/i18n/pt-BR.json](webui/static/i18n/pt-BR.json)
- [infra/](infra/) (container build + proxy config)
  - [infra/webui.Dockerfile](infra/webui.Dockerfile) — two-stage build, copies `bitcoin-cli` from the Bitcoin Core image
  - [infra/entrypoint.sh](infra/entrypoint.sh) — renders `~/.bitcoin/bitcoin.conf` from `.env`, then execs uvicorn
  - [infra/nginx.conf](infra/nginx.conf)
- [bitcoind/bitcoin.conf](bitcoind/bitcoin.conf) — config mounted into the `bitcoind` container
- [docker-compose.yml](docker-compose.yml)
- [.env_template](.env_template) — copy to `.env` on first run
- [.dockerignore](.dockerignore) / [.gitignore](.gitignore)

## Network architecture

```text
Browser
  │  HTTP :8080
  ▼
proxy (nginx)  ──► webui (FastAPI) ──► bitcoind (JSON-RPC)
```

Only port `8080` is published, and only on `127.0.0.1` (loopback). Compose
networks `app` and `rpc` are declared `internal: true`, so `bitcoind` is
unreachable from the host and the WebUI is only reachable via the proxy. The
`webui` container runs as non-root (`sandbox`, uid 1000), read-only with
tmpfs mounts for `/tmp` and `~/.bitcoin`, all Linux capabilities dropped, and
`no-new-privileges` set. The proxy container is hardened likewise and keeps
only the minimal capability set nginx needs to start.

If you need to expose the WebUI on a LAN, edit the `ports:` mapping in
[docker-compose.yml](docker-compose.yml) *and* add authentication in front of
it (nginx `basic_auth`, a tunnel, a reverse proxy with auth, etc.) — the
`/api/exec` endpoint runs shell commands inside the container and must not be
reachable without auth.

## Ports and credentials

- Host: `8080` → proxy → webui (bound to `127.0.0.1` only)
- RPC (internal): `bitcoind:18443`
- P2P regtest (internal): `18444`

RPC credentials live in [bitcoind/bitcoin.conf](bitcoind/bitcoin.conf) and are
also passed to the WebUI via `.env`:

```ini
rpcuser=bitcoin
rpcpassword=bitcoin
```

Do not expose this environment to the internet.

Example RPC call from inside the environment:

```bash
docker compose exec -T webui curl --user bitcoin:bitcoin \
  --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
  -H 'content-type: text/plain;' \
  http://bitcoind:18443/
```

## Persistence and reset

Data is stored in the `bitcoind-data` named volume.

- Stop without deleting data:

```bash
docker compose down
```

- Full reset (deletes wallets/blocks from the volume):

```bash
docker compose down -v
```

## Troubleshooting

- `Could not locate RPC credentials ... /root/.bitcoin/bitcoin.conf`: run
  `bitcoin-cli` as the `bitcoin` user so it reads the right config:

```bash
docker compose exec --user bitcoin bitcoind bitcoin-cli -regtest getblockchaininfo
```

- `502 Bad Gateway` right after startup: wait a few seconds and reload — the
  WebUI is still coming up behind the proxy.
- Port 8080 already in use: change `HOST_PORT` in `.env` (e.g.
  `HOST_PORT=18080`).
- Credentials changed in `.env` but RPC still fails: make sure
  `bitcoind/bitcoin.conf` was updated to match and recreate the stack with
  `docker compose up -d --build`.

## References

- [Bitcoin Core — docs](https://bitcoincore.org/en/doc/)
- [Bitcoin RPC reference](https://developer.bitcoin.org/reference/rpc/)
