<div align="center">

# ⛏️ Bitcoin Core Terminal

### Laboratório local de Bitcoin Core em regtest com terminal no navegador

[![Bitcoin Core](https://img.shields.io/badge/Bitcoin%20Core-30.0-F7931A?logo=bitcoin&logoColor=white)](https://bitcoincore.org/)
[![Docker](https://img.shields.io/badge/Docker%20Compose-ready-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Python](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![nginx](https://img.shields.io/badge/nginx-1.30--alpine-009639?logo=nginx&logoColor=white)](https://nginx.org/)

[🇬🇧 English](README.md) · **🇧🇷 Português**

</div>

---

## ⚡ TL;DR — Subir rápido

```bash
git clone https://github.com/gustavoschaedler/bitcoin-core-terminal.git
cd bitcoin-core-terminal
cp .env_template .env
docker compose up -d --build
open http://localhost:8080
```

Pronto. Você tem um node `bitcoin-core` em regtest novinho e um terminal no
navegador com snippets. Veja [Smoke test](#-smoke-test) pra confirmar.

---

## 📖 Índice

- [⛏️ Bitcoin Core Terminal](#️-bitcoin-core-terminal)
    - [Laboratório local de Bitcoin Core em regtest com terminal no navegador](#laboratório-local-de-bitcoin-core-em-regtest-com-terminal-no-navegador)
  - [⚡ TL;DR — Subir rápido](#-tldr--subir-rápido)
  - [📖 Índice](#-índice)
  - [📦 O que vem dentro](#-o-que-vem-dentro)
  - [✅ Pré-requisitos](#-pré-requisitos)
  - [⚙️ Configuração (.env)](#️-configuração-env)
  - [🚀 Subir o ambiente](#-subir-o-ambiente)
  - [🧪 Smoke test](#-smoke-test)
  - [🛠️ Usar o bitcoin-cli](#️-usar-o-bitcoin-cli)
  - [💻 Terminal Web](#-terminal-web)
  - [🌐 API HTTP](#-api-http)
  - [🗂️ Estrutura do projeto](#️-estrutura-do-projeto)
  - [🛡️ Arquitetura (rede)](#️-arquitetura-rede)
  - [🔌 Portas e credenciais](#-portas-e-credenciais)
  - [💾 Persistência e reset](#-persistência-e-reset)
  - [🔧 Troubleshooting](#-troubleshooting)
  - [📚 Referências](#-referências)
  - [⚡ Doações](#-doações)

---

## 📦 O que vem dentro

- **`bitcoind`** (regtest) com dados persistidos em volume nomeado, e
  healthcheck no container para que os serviços dependentes só subam quando
  o node estiver realmente respondendo.
- **Terminal Web** (FastAPI + HTML/CSS/JS) com snippets, splits arrastáveis,
  seletor de idioma (Inglês / Português) e UX de terminal.
- **Proxy** (nginx) expondo apenas a UI no host, com headers de segurança e
  cache-busting para desenvolvimento.

---

## ✅ Pré-requisitos

- Docker Engine + Docker Compose (plugin `docker compose`)

Verifique:

```bash
docker --version
docker compose version
```

---

## ⚙️ Configuração (.env)

Copie o template antes da primeira execução (o `.env` fica no `.gitignore`
de propósito — contém credenciais):

```bash
cp .env_template .env
```

| Chave                              | Propósito                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `HOST_PORT`                        | Porta publicada pelo proxy nginx no host                                                                  |
| `BITCOIN_REPO` · `BITCOIN_VERSION` | Imagem do Bitcoin Core (também usada como build stage para copiar o `bitcoin-cli` para a imagem do WebUI) |
| `PYTHON_IMAGE`                     | Imagem base do Python do container do WebUI                                                               |
| `NGINX_IMAGE`                      | Imagem do nginx usada pelo proxy reverso                                                                  |
| `VERSION`                          | Versão exibida no topo do WebUI                                                                           |
| `BITCOIND_HOST` · `BITCOIND_PORT`  | Endpoint RPC usado pelo WebUI                                                                             |
| `BITCOIND_USER` · `BITCOIND_PASS`  | Credenciais RPC usadas pelo WebUI                                                                         |

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

> [!IMPORTANT]
> Se trocar `BITCOIND_USER` / `BITCOIND_PASS` no `.env`, também atualize
> `rpcuser` / `rpcpassword` em [`bitcoind/bitcoin.conf`](bitcoind/bitcoin.conf)
> para bater com o valor novo. O container do WebUI regenera o próprio
> `~/.bitcoin/bitcoin.conf` no startup a partir do `.env`, via
> [`infra/entrypoint.sh`](infra/entrypoint.sh), então esse lado já fica
> sincronizado automaticamente.

---

## 🚀 Subir o ambiente

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
depois de subir, é só porque o proxy levantou um instante antes do backend
— aguarde alguns segundos e recarregue.

---

## 🧪 Smoke test

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

---

## 🛠️ Usar o bitcoin-cli

O `bitcoin-cli` já está instalado tanto no container `bitcoind` quanto no
container `webui` (não precisa instalar no host). A partir do `bitcoind`:

```bash
docker compose exec --user bitcoin bitcoind bitcoin-cli -regtest getblockcount
```

Opcional: alias (roda a partir da pasta do projeto):

```bash
alias bitcoin-cli='docker compose exec -T --user bitcoin bitcoind bitcoin-cli'
```

---

## 💻 Terminal Web

O terminal do navegador aceita comandos no estilo `bitcoin-cli` (com parsing
automático de tipos) e um subset pequeno de shell para ergonomia (pipes para
`jq`, `grep`, `less`, etc.). Inclui:

- Splits e divisores arrastáveis (múltiplos panes, criados/fechados à
  vontade).
- Histórico por pane (`↑` / `↓`), limpar com `Ctrl+L`, e comando `clear`.
- Snippets por seção, com busca (e destaque do texto encontrado),
  recolher/expandir e sidebar redimensionável.
- Autocomplete baseado nos snippets (`Tab` e `→` completam).
- Paste multi-linha em comandos longos.
- Renderização distinta para stdout e stderr.
- Seletor de idioma (Inglês / Português) na barra superior.
- Flags úteis:
  - `-rpcwallet=NOME` (wallet por chamada)
  - `-generate N` (atalho para minerar no regtest)

---

## 🌐 API HTTP

| Método | Path           | Descrição                                                                     |
| ------ | -------------- | ----------------------------------------------------------------------------- |
| `GET`  | `/api/health`  | Faz round-trip de `getblockchaininfo` no bitcoind                             |
| `GET`  | `/api/meta`    | Versões do WebUI / Python / Bitcoin Core                                      |
| `GET`  | `/api/wallets` | Wallets carregadas (atalho para `listwallets`)                                |
| `POST` | `/api/rpc`     | Proxy JSON-RPC — body: `{method, params, wallet?}`                            |
| `POST` | `/api/exec`    | Executa comando shell no sandbox do WebUI — body: `{command, cwd?, timeout?}` |
| `GET`  | `/api`         | Docs OpenAPI (Swagger UI)                                                     |

`/api/exec` limita a saída em ~1 MiB, timeout padrão 30 s (máx. 120 s). O
processo roda em seu próprio process group e a árvore inteira é morta no
timeout. As entradas têm limites de tamanho na camada do Pydantic para
evitar abuso acidental.

---

## 🗂️ Estrutura do projeto

```text
bitcoin-coders-bootcamp/
├── backend/                app FastAPI
│   ├── app.py              proxy RPC + exec no sandbox + cliente httpx por lifespan
│   └── requirements.txt
├── bitcoind/
│   └── bitcoin.conf        montado no container bitcoind
├── infra/                  build do container + config do proxy
│   ├── webui.Dockerfile    build em duas stages, copia o bitcoin-cli da imagem oficial
│   ├── entrypoint.sh       gera o ~/.bitcoin/bitcoin.conf do .env e dá exec no uvicorn
│   └── nginx.conf
├── webui/static/           frontend
│   ├── index.html
│   ├── app.css
│   ├── app.js
│   ├── snippets.html
│   └── i18n/
│       ├── en-GB.json
│       └── pt-BR.json
├── docker-compose.yml
├── .env_template           copie para .env na primeira execução
├── .dockerignore
└── .gitignore
```

---

## 🛡️ Arquitetura (rede)

```text
Navegador
  │  HTTP :8080 (só 127.0.0.1)
  ▼
proxy (nginx)  ──►  webui (FastAPI)  ──►  bitcoind (JSON-RPC)
```

Somente a porta `8080` é publicada, e apenas em `127.0.0.1` (loopback). As
redes do Compose `app` e `rpc` estão declaradas como `internal: true`, então
o `bitcoind` não é acessível a partir do host e o WebUI só é acessível via o
proxy. O container `webui` roda como usuário não-root (`sandbox`, uid 1000),
em `read_only` com tmpfs para `/tmp` e `~/.bitcoin`, com todas as
capabilities Linux removidas e `no-new-privileges` ativo. O container do
proxy também é endurecido e mantém apenas o conjunto mínimo de capabilities
que o nginx precisa para subir.

> [!WARNING]
> Se precisar expor o WebUI na LAN, edite o `ports:` do
> [docker-compose.yml](docker-compose.yml) **e** adicione autenticação na
> frente (nginx `basic_auth`, um túnel, um reverse proxy com auth, etc.) —
> o endpoint `/api/exec` executa comandos shell dentro do container e não
> pode ficar acessível sem autenticação.

---

## 🔌 Portas e credenciais

| Escopo                | Endereço                         |
| --------------------- | -------------------------------- |
| Host                  | `127.0.0.1:8080` → proxy → webui |
| RPC (interno)         | `bitcoind:18443`                 |
| P2P regtest (interno) | `18444`                          |

As credenciais RPC ficam em [bitcoind/bitcoin.conf](bitcoind/bitcoin.conf) e
também são passadas para o WebUI via `.env`:

```ini
rpcuser=bitcoin
rpcpassword=bitcoin
```

> [!CAUTION]
> Não exponha esse ambiente na internet.

<details>
<summary>Exemplo de chamada JSON-RPC crua a partir de dentro do ambiente</summary>

```bash
docker compose exec -T webui curl --user bitcoin:bitcoin \
  --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
  -H 'content-type: text/plain;' \
  http://bitcoind:18443/
```

</details>

---

## 💾 Persistência e reset

Os dados ficam no volume nomeado `bitcoind-data`.

- Parar sem apagar dados:

```bash
docker compose down
```

- Reset total (apaga wallets/blocos do volume):

```bash
docker compose down -v
```

---

## 🔧 Troubleshooting

<details>
<summary><code>Could not locate RPC credentials ... /root/.bitcoin/bitcoin.conf</code></summary>

Rode o `bitcoin-cli` como usuário `bitcoin` para que ele leia o arquivo
correto:

```bash
docker compose exec --user bitcoin bitcoind bitcoin-cli -regtest getblockchaininfo
```

</details>

<details>
<summary><code>502 Bad Gateway</code> ao abrir a UI logo após subir</summary>

Aguarde alguns segundos e recarregue — o WebUI ainda está subindo atrás do
proxy.

</details>

<details>
<summary>Porta 8080 já em uso</summary>

Altere `HOST_PORT` no `.env` (ex.: `HOST_PORT=18080`) e recrie o stack.

</details>

<details>
<summary>Credenciais mudadas no <code>.env</code> mas o RPC continua falhando</summary>

Confirme que o `bitcoind/bitcoin.conf` foi atualizado para bater e recrie o
stack com `docker compose up -d --build`.

</details>

---

## 📚 Referências

- [Bitcoin Core — docs](https://bitcoincore.org/en/doc/)
- [Bitcoin RPC reference](https://developer.bitcoin.org/reference/rpc/)

---

## ⚡ Doações

Se esse projeto te ajudou, uma gorjeta é muito bem-vinda — ajuda a manter as
luzes acesas.

> [!NOTE]
> Os endereços abaixo são **placeholders**. Troque pelos seus e os QR codes
> atualizam sozinhos (são gerados a partir da URL).

<table>
<tr>
<th align="center">⛓️ Bitcoin (on-chain)</th>
<th align="center">⚡ Lightning Network</th>
</tr>
<tr>
<td align="center" width="50%">
<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=bitcoin%3Abc1qSUBSTITUAPELOSEUENDERECOBTCMAINNETXXXXXXXX" alt="QR BTC on-chain" width="220" height="220" /><br/>
<sub><code>bc1qSUBSTITUAPELOSEUENDERECOBTCMAINNETXXXXXXXX</code></sub>
</td>
<td align="center" width="50%">
<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=your-lightning-address%40your-provider.com" alt="QR Lightning" width="220" height="220" /><br/>
<sub><code>your-lightning-address@your-provider.com</code></sub>
</td>
</tr>
</table>

---

<div align="center">
<sub>Feito com ⛏️ para quem está aprendendo Bitcoin · <a href="README.md">🇬🇧 English version</a></sub>
</div>
