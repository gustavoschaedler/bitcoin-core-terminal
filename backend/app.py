"""
WebUI for the Bitcoin Core Bootcamp.

FastAPI backend that:
  - serves an HTML/JS terminal (static/index.html)
  - proxies JSON-RPC calls to the `bitcoind` container on the compose network
  - executes shell commands INSIDE the container itself (sandbox)

Endpoints:
  GET  /                  -> web terminal
  POST /api/rpc           -> RPC proxy. Body: {method, params, wallet?}
  POST /api/exec          -> runs a shell command in the container.
                             Body: {command}
  GET  /api/health        -> node health check
  GET  /api/wallets       -> lists loaded wallets (shortcut)
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import platform
import signal
import uuid
from contextlib import asynccontextmanager
from typing import Annotated, Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

log = logging.getLogger("webui")

# --------------------------------------------------------------------------- #
# Config (read from env, with docker-compose defaults)
# --------------------------------------------------------------------------- #
BITCOIND_HOST = os.getenv("BITCOIND_HOST", "bitcoind")
BITCOIND_PORT = int(os.getenv("BITCOIND_PORT", "18443"))
BITCOIND_USER = os.getenv("BITCOIND_USER", "bitcoin")
BITCOIND_PASS = os.getenv("BITCOIND_PASS", "bitcoin")
BITCOIND_COOKIE_FILE = os.getenv("BITCOIND_COOKIE_FILE")

RPC_BASE = f"http://{BITCOIND_HOST}:{BITCOIND_PORT}"
RPC_TIMEOUT = float(os.getenv("RPC_TIMEOUT", "30"))

_candidates = [
    (os.getenv("STATIC_DIR") or "").strip() or None,
    os.path.join(os.path.dirname(__file__), "static"),
    os.path.join(os.path.dirname(__file__), "..", "webui", "static"),
]
STATIC_DIR = next(
    (p for p in _candidates if p and os.path.isdir(p)),
    _candidates[1],
)


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
# Upper bounds chosen to stop accidental abuse without limiting legitimate use.
MAX_METHOD_LEN = 128
MAX_WALLET_LEN = 128
MAX_PARAMS = 64
MAX_COMMAND_LEN = 32_768
MAX_CWD_LEN = 1_024


class RpcRequest(BaseModel):
    method: Annotated[str, Field(min_length=1, max_length=MAX_METHOD_LEN)]
    params: Annotated[list[Any], Field(max_length=MAX_PARAMS)] = []
    wallet: Annotated[str | None, Field(max_length=MAX_WALLET_LEN)] = None


class ExecRequest(BaseModel):
    command: Annotated[str, Field(min_length=1, max_length=MAX_COMMAND_LEN)]
    cwd: Annotated[str | None, Field(max_length=MAX_CWD_LEN)] = None
    timeout: Annotated[float | None, Field(gt=0, le=120)] = None


# --------------------------------------------------------------------------- #
# Exec limits (sandbox)
# --------------------------------------------------------------------------- #
EXEC_DEFAULT_TIMEOUT = 30.0
EXEC_MAX_TIMEOUT = 120.0
EXEC_MAX_OUTPUT = 1_048_576


# --------------------------------------------------------------------------- #
# Shared HTTP client (managed by lifespan)
# --------------------------------------------------------------------------- #
@asynccontextmanager
async def lifespan(app_: FastAPI):
    # One shared AsyncClient = one connection pool, reused across requests.
    async with httpx.AsyncClient(timeout=RPC_TIMEOUT) as client:
        app_.state.http = client
        yield


app = FastAPI(
    title="Bitcoin Core WebUI",
    version="0.1.0",
    docs_url="/api",
    openapi_url="/api/openapi.json",
    redoc_url=None,
    lifespan=lifespan,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def get_rpc_auth() -> tuple[str, str]:
    """Returns (user, password) for bitcoind RPC.

    If BITCOIND_COOKIE_FILE is set, tries to read the cookie; if reading fails,
    falls back to user/password from env and logs a warning (so misconfigured
    cookie paths do not silently authenticate with the wrong credentials).
    """
    if BITCOIND_COOKIE_FILE:
        try:
            with open(BITCOIND_COOKIE_FILE, "r", encoding="utf-8") as f:
                raw = f.read().strip()
            user, password = raw.split(":", 1)
            if user and password:
                return user, password
            log.warning(
                "BITCOIND_COOKIE_FILE=%s is empty or malformed; "
                "falling back to BITCOIND_USER/BITCOIND_PASS.",
                BITCOIND_COOKIE_FILE,
            )
        except (OSError, ValueError) as exc:
            log.warning(
                "Could not read BITCOIND_COOKIE_FILE=%s (%s); "
                "falling back to BITCOIND_USER/BITCOIND_PASS.",
                BITCOIND_COOKIE_FILE,
                exc,
            )

    return BITCOIND_USER, BITCOIND_PASS


async def call_rpc(
    method: str,
    params: list[Any],
    wallet: str | None = None,
) -> Any:
    url = RPC_BASE
    if wallet:
        url = f"{RPC_BASE}/wallet/{wallet}"

    payload = {
        "jsonrpc": "1.0",
        "id": uuid.uuid4().hex,
        "method": method,
        "params": params,
    }

    try:
        r = await app.state.http.post(url, json=payload, auth=get_rpc_auth())
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "bitcoind_connect_failed",
                "rpc_base": RPC_BASE,
                "error": str(exc),
            },
        ) from exc

    try:
        body = r.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "bitcoind_non_json",
                "status": r.status_code,
                "body": r.text[:200],
            },
        ) from exc

    if body.get("error"):
        err = body["error"]
        raise HTTPException(
            status_code=400,
            detail={
                "rpc_code": err.get("code"),
                "rpc_message": err.get("message"),
            },
        )

    return body.get("result")


async def _kill_process_tree(proc: asyncio.subprocess.Process) -> None:
    """Kills the whole process group, so background children of the shell die too."""
    with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGKILL)
    with contextlib.suppress(ProcessLookupError):
        proc.kill()
    with contextlib.suppress(ProcessLookupError):
        await proc.wait()


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get(
    "/api/health",
    responses={
        400: {"description": "Error returned by bitcoind JSON-RPC"},
        502: {"description": "Failed to connect to bitcoind"},
    },
)
async def health() -> dict[str, Any]:
    info = await call_rpc("getblockchaininfo", [])
    return {
        "ok": True,
        "chain": info.get("chain"),
        "blocks": info.get("blocks"),
        "bestblockhash": info.get("bestblockhash"),
    }


@app.get("/api/version")
async def version() -> dict[str, Any]:
    v = (os.getenv("VERSION") or "").strip()
    return {"version": v}


@app.get("/api/meta")
async def meta() -> dict[str, Any]:
    v = (os.getenv("VERSION") or "").strip()
    bitcoin_repo = (os.getenv("BITCOIN_REPO") or "").strip()
    bitcoin_version = (os.getenv("BITCOIN_VERSION") or "").strip()
    python_version = platform.python_version()
    return {
        "version": v,
        "python_version": python_version,
        "bitcoin_repo": bitcoin_repo,
        "bitcoin_version": bitcoin_version,
    }


@app.get(
    "/api/wallets",
    responses={
        400: {"description": "Error returned by bitcoind JSON-RPC"},
        502: {"description": "Failed to connect to bitcoind"},
    },
)
async def wallets() -> dict[str, Any]:
    loaded = await call_rpc("listwallets", [])
    return {"loaded": loaded}


@app.post(
    "/api/rpc",
    responses={
        400: {"description": "Error returned by bitcoind JSON-RPC"},
        502: {"description": "Failed to connect to bitcoind"},
    },
)
async def rpc(req: RpcRequest) -> dict[str, Any]:
    result = await call_rpc(req.method, req.params, req.wallet)
    return {"result": result}


@app.post(
    "/api/exec",
    responses={
        400: {"description": "Invalid input / failed to start process"},
        408: {"description": "Timeout while executing command"},
    },
)
async def exec_cmd(req: ExecRequest) -> dict[str, Any]:
    cmd = req.command.strip()
    if not cmd:
        raise HTTPException(
            status_code=400,
            detail={"code": "exec_empty_command"},
        )

    timeout = min(req.timeout or EXEC_DEFAULT_TIMEOUT, EXEC_MAX_TIMEOUT)

    try:
        # start_new_session=True puts the shell (and its children) in a new
        # process group so we can SIGKILL the whole tree on timeout.
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=req.cwd,
            start_new_session=True,
        )
    except (OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail={"code": "exec_start_failed", "error": str(exc)},
        ) from exc

    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(),
            timeout=timeout,
        )
    except asyncio.TimeoutError as exc:
        await _kill_process_tree(proc)
        raise HTTPException(
            status_code=408,
            detail={"code": "exec_timeout", "timeout": timeout},
        ) from exc

    truncated = False
    if len(stdout_b) > EXEC_MAX_OUTPUT:
        stdout_b = stdout_b[:EXEC_MAX_OUTPUT]
        truncated = True
    if len(stderr_b) > EXEC_MAX_OUTPUT:
        stderr_b = stderr_b[:EXEC_MAX_OUTPUT]
        truncated = True

    return {
        "stdout": stdout_b.decode("utf-8", errors="replace"),
        "stderr": stderr_b.decode("utf-8", errors="replace"),
        "exit_code": proc.returncode,
        "truncated": truncated,
    }


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
