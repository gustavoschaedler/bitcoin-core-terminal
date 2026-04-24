# ⛏️ Bitcoin Core Terminal

Ambiente local de **Bitcoin Core em regtest** via Docker Compose, com:

- `bitcoind` (regtest) com dados persistidos em volume nomeado, e healthcheck
  no container para que os serviços dependentes só subam quando o node
  estiver realmente respondendo.
- Terminal Web (FastAPI + HTML/CSS/JS) com snippets, splits arrastáveis,
  seletor de idioma (Inglês / Português) e UX de terminal.
- Proxy (nginx) expondo apenas a UI no host, com headers de segurança e
  cache-busting para desenvolvimento.

## Pré-requisitos

- Docker Engine + Docker Compose (plugin `docker compose`)

Verifique:

```bash
docker --version
docker compose version
```

## Configuração (.env)

Copie o template antes da primeira execução (o `.env` fica no `.gitignore` de
propósito — contém credenciais):

```bash
cp .env_template .env
```

Chaves de configuração:

- `HOST_PORT` (porta publicada pelo proxy nginx no host)
- `BITCOIN_REPO` e `BITCOIN_VERSION` (imagem do Bitcoin Core — também usada
  como build stage para copiar o `bitcoin-cli` para a imagem do WebUI)
- `PYTHON_IMAGE` (imagem base do Python do container do WebUI)
- `NGINX_IMAGE` (imagem do nginx usada pelo proxy reverso)
- `VERSION` (versão exibida no topo do WebUI)
- `BITCOIND_HOST`, `BITCOIND_PORT`, `BITCOIND_USER`, `BITCOIND_PASS`
  (endpoint RPC e credenciais usadas pelo WebUI)

Exemplo:

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

Para atualizar o Bitcoin Core no futuro (ex.: 31.0), altere somente:

```ini
BITCOIN_VERSION=31.0
```

> Se trocar `BITCOIND_USER` / `BITCOIND_PASS` no `.env`, também atualize
> `rpcuser` / `rpcpassword` em [`bitcoind/bitcoin.conf`](bitcoind/bitcoin.conf)
> para bater com o valor novo. O container do WebUI regenera o próprio
> `~/.bitcoin/bitcoin.conf` a partir do `.env` no startup, via
> [`infra/entrypoint.sh`](infra/entrypoint.sh), então esse lado já fica
> sincronizado automaticamente.

## Subir o ambiente

Na raiz do projeto:

```bash
docker compose up -d --build
```

Acesse:

```text
http://localhost:8080
```

O WebUI espera o `bitcoind` ficar saudável (`getblockchaininfo` responder)
antes de subir, e o nginx espera o WebUI. Se aparecer `502 Bad Gateway` logo
depois de subir, é só porque o proxy levantou um instante antes do backend —
aguarde alguns segundos e recarregue.

## Smoke test

Usando `bitcoin-cli` a partir do container `bitcoind`:

```bash
docker compose exec --user bitcoin bitcoind bitcoin-cli -regtest getblockchaininfo
```

Usando `bitcoin-cli` a partir do container do WebUI (o sandbox usado pelos
comandos shell do Terminal Web):

```bash
docker compose exec webui bitcoin-cli getblockchaininfo
```

Via HTTP do WebUI:

```bash
curl http://localhost:8080/api/health
```

Versões (software/Python/Bitcoin):

```bash
curl http://localhost:8080/api/meta
```

## Usar o bitcoin-cli

O `bitcoin-cli` já está instalado tanto no container `bitcoind` quanto no
container `webui` (não precisa instalar no host). A partir do `bitcoind`:

```bash
docker compose exec --user bitcoin bitcoind bitcoin-cli -regtest getblockcount
```

Opcional: alias (roda a partir da pasta do projeto):

```bash
alias bitcoin-cli='docker compose exec -T --user bitcoin bitcoind bitcoin-cli'
```

## Terminal Web

O terminal do navegador aceita comandos no estilo `bitcoin-cli` (com parsing
automático de tipos) e um subset pequeno de shell para ergonomia (pipes para
`jq`, `grep`, `less`, etc.). Inclui:

- Splits e divisores arrastáveis (múltiplos panes, criados/fechados à
  vontade).
- Histórico por pane (`↑`/`↓`), limpar com `Ctrl+L`, e comando `clear`.
- Snippets por seção, com busca (e destaque do texto encontrado),
  recolher/expandir e sidebar redimensionável.
- Autocomplete baseado nos snippets (`Tab` e `→` completam).
- Paste multi-linha em comandos longos.
- Renderização distinta para stdout e stderr.
- Seletor de idioma (Inglês / Português) na barra superior.
- Flags úteis:
  - `-rpcwallet=NOME` (wallet por chamada)
  - `-generate N` (atalho para minerar no regtest)

## API HTTP

- `GET  /api/health` — faz um round-trip de `getblockchaininfo` no bitcoind.
- `GET  /api/meta` — versões do WebUI / Python / Bitcoin Core.
- `GET  /api/wallets` — wallets carregadas (atalho para `listwallets`).
- `POST /api/rpc` — proxy JSON-RPC. Body: `{method, params, wallet?}`.
- `POST /api/exec` — executa um comando shell no sandbox do WebUI. Body:
  `{command, cwd?, timeout?}`. Saída limitada a ~1 MiB, timeout padrão de
  30 s (máximo 120 s). O processo roda em seu próprio process group e a
  árvore inteira é morta no timeout.
- Docs OpenAPI ficam em `/api` (Swagger UI).

As entradas têm limites de tamanho na camada do Pydantic para evitar abuso
acidental.

## Estrutura do projeto

- [backend/](backend/) (FastAPI)
  - [backend/app.py](backend/app.py) — proxy RPC, exec no sandbox, cliente httpx gerenciado por lifespan
  - [backend/requirements.txt](backend/requirements.txt)
- [webui/static/](webui/static/) (frontend)
  - [webui/static/index.html](webui/static/index.html)
  - [webui/static/app.css](webui/static/app.css)
  - [webui/static/app.js](webui/static/app.js)
  - [webui/static/snippets.html](webui/static/snippets.html)
  - [webui/static/i18n/en-GB.json](webui/static/i18n/en-GB.json)
  - [webui/static/i18n/pt-BR.json](webui/static/i18n/pt-BR.json)
- [infra/](infra/) (build do container + config do proxy)
  - [infra/webui.Dockerfile](infra/webui.Dockerfile) — build em duas stages, copia o `bitcoin-cli` da imagem oficial do Bitcoin Core
  - [infra/entrypoint.sh](infra/entrypoint.sh) — gera o `~/.bitcoin/bitcoin.conf` a partir do `.env` e dá exec no uvicorn
  - [infra/nginx.conf](infra/nginx.conf)
- [bitcoind/bitcoin.conf](bitcoind/bitcoin.conf) — config montada no container `bitcoind`
- [docker-compose.yml](docker-compose.yml)
- [.env_template](.env_template) — copie para `.env` na primeira execução
- [.dockerignore](.dockerignore) / [.gitignore](.gitignore)

## Arquitetura (rede)

```text
Navegador
  │  HTTP :8080
  ▼
proxy (nginx)  ──► webui (FastAPI) ──► bitcoind (JSON-RPC)
```

Somente a porta `8080` é publicada, e apenas em `127.0.0.1` (loopback). As
redes do Compose `app` e `rpc` estão declaradas como `internal: true`, então
o `bitcoind` não é acessível a partir do host e o WebUI só é acessível via o
proxy. O container `webui` roda como usuário não-root (`sandbox`, uid 1000),
em `read_only` com tmpfs para `/tmp` e `~/.bitcoin`, com todas as
capabilities Linux removidas e `no-new-privileges` ativo. O container do
proxy também é endurecido e mantém apenas o conjunto mínimo de capabilities
que o nginx precisa pra subir.

Se precisar expor o WebUI na LAN, edite o `ports:` do
[docker-compose.yml](docker-compose.yml) *e* adicione autenticação na frente
(nginx `basic_auth`, um túnel, um reverse proxy com auth, etc.) — o endpoint
`/api/exec` executa comandos shell dentro do container e não pode ficar
acessível sem autenticação.

## Portas e credenciais

- Host: `8080` → proxy → webui (bound só em `127.0.0.1`)
- RPC (interno): `bitcoind:18443`
- P2P regtest (interno): `18444`

As credenciais RPC ficam em [bitcoind/bitcoin.conf](bitcoind/bitcoin.conf) e
também são passadas para o WebUI via `.env`:

```ini
rpcuser=bitcoin
rpcpassword=bitcoin
```

Não exponha esse ambiente na internet.

Exemplo de chamada RPC a partir de dentro do ambiente:

```bash
docker compose exec -T webui curl --user bitcoin:bitcoin \
  --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
  -H 'content-type: text/plain;' \
  http://bitcoind:18443/
```

## Persistência e reset

Os dados ficam no volume nomeado `bitcoind-data`.

- Parar sem apagar dados:

```bash
docker compose down
```

- Reset total (apaga wallets/blocos do volume):

```bash
docker compose down -v
```

## Troubleshooting

- `Could not locate RPC credentials ... /root/.bitcoin/bitcoin.conf`: rode o
  `bitcoin-cli` como usuário `bitcoin` pra que ele leia o arquivo correto:

```bash
docker compose exec --user bitcoin bitcoind bitcoin-cli -regtest getblockchaininfo
```

- `502 Bad Gateway` ao abrir a UI logo após subir: aguarde alguns segundos e
  recarregue — o WebUI ainda está subindo atrás do proxy.
- Porta 8080 em uso: altere `HOST_PORT` no `.env` (ex.: `HOST_PORT=18080`).
- Credenciais mudadas no `.env` mas o RPC continua falhando: confirme que o
  `bitcoind/bitcoin.conf` foi atualizado para bater e recrie o stack com
  `docker compose up -d --build`.

## Referências

- [Bitcoin Core — docs](https://bitcoincore.org/en/doc/)
- [Bitcoin RPC reference](https://developer.bitcoin.org/reference/rpc/)
