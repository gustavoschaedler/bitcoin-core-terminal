# =============================================================================
# Stage 1: copy bitcoin-cli from the official Bitcoin Core image
# =============================================================================
ARG PYTHON_IMAGE=python:3.14-slim
ARG BITCOIN_REPO=bitcoin/bitcoin
ARG BITCOIN_VERSION=30.0

FROM ${BITCOIN_REPO}:${BITCOIN_VERSION} AS bitcoin

# =============================================================================
# Stage 2: final WebUI image — Python + sandbox shell
# =============================================================================
FROM ${PYTHON_IMAGE}

ARG BITCOIN_VERSION=30.0

# UTF-8 everywhere so jq/grep/sed handle non-ASCII correctly.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        jq \
        grep \
        sed \
        gawk \
        findutils \
        less \
        procps \
        coreutils \
    && rm -rf /var/lib/apt/lists/*

# --- bitcoin-cli from stage 1 -----------------------------------------------
COPY --from=bitcoin /opt/bitcoin-${BITCOIN_VERSION}/bin/bitcoin-cli /usr/local/bin/bitcoin-cli

# --- unprivileged user for the sandbox --------------------------------------
RUN useradd -m -s /bin/bash -u 1000 sandbox

# --- Python app -------------------------------------------------------------
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app.py ./app.py
COPY webui/static ./static
RUN chmod -R a+rX /app && chown -R sandbox:sandbox /app

# --- entrypoint: renders bitcoin-cli.conf from env, then execs uvicorn ------
COPY --chmod=0755 infra/entrypoint.sh /usr/local/bin/entrypoint.sh

# --- runtime as sandbox user (non-root) -------------------------------------
USER sandbox
ENV HOME=/home/sandbox
WORKDIR /home/sandbox

EXPOSE 8181
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
