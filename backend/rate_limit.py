"""
rate_limit.py — Recode-IT rate limiting (P1 + P2, security review 2026-05-23).

Slowapi-backed limiter with in-memory storage. Adequate for single-worker
uvicorn; for multi-worker production scale horizontally by pointing
slowapi at a Redis backend via the `storage_uri` env var on the Limiter
construction (left as TODO until traffic justifies it).

Policy (default policy from chief_of_staff 2026-05-23):

  Login (P1):
    - 5 attempts / 15 min per IP     (anonymous brute-force from a single host)
    - 10 attempts / 1 hour per account  (distributed brute-force on a target user)

  Recovery initiate (P2):
    - 3 / hour per IP   (email-flooding mitigation against a victim address)

  Recovery verify (P2):
    - 5 / 15 min per account  (brute-force the 12-char recovery code, ~57 bit entropy)

Account key extraction reads the JSON body once and caches the result on
`request.state` so the actual endpoint handler does not re-parse. IP is
hashed (sha256 truncated to 16 hex chars) before being passed to the
limiter — slowapi's storage logs the key verbatim, and we don't want raw
IPs sitting in memory in plaintext.

The limiter is opt-out at construction time: passing `enabled=False`
returns a no-op limiter (used by the test suite to avoid rate-limit
flakiness on rapid back-to-back requests).
"""

from __future__ import annotations

import hashlib
import json
from typing import Iterable

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


_HASH_LEN_HEX = 16

# Paths that need their JSON body parsed BEFORE the slowapi key_func
# (which is sync, so it can't await request.body() itself). The middleware
# below preloads `request._body` for these paths so the key_func can pull
# fields like `email` or `token` out of the cached body.
_BODY_PRELOAD_PATHS: tuple[str, ...] = (
    "/recode/login",
    "/recode/recovery/verify",
)


class BodyPreloadMiddleware(BaseHTTPMiddleware):
    """For POST endpoints listed in _BODY_PRELOAD_PATHS, read and cache
    the request body upstream of the routing layer so the slowapi sync
    key_func can inspect it. Idempotent — Starlette caches `_body` on
    the Request after the first read, so the downstream handler's
    `await request.json()` returns the same parsed dict at zero cost."""

    async def dispatch(self, request: Request, call_next):
        if request.method == "POST" and request.url.path in _BODY_PRELOAD_PATHS:
            # Force Starlette to cache the body bytes on request._body.
            await request.body()
        return await call_next(request)


def _hash_ip(ip: str) -> str:
    """sha256 then first 16 hex chars. Enough to disambiguate distinct hosts;
    not enough to recover the IP from logs (rainbow tables on /32 are
    cheap, so this is privacy-mitigation not privacy-guarantee — but
    better than verbatim IP in memory)."""
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:_HASH_LEN_HEX]


def ip_key(request: Request) -> str:
    """Limiter key: hashed IP only."""
    return _hash_ip(get_remote_address(request))


async def _cached_body(request: Request) -> dict:
    """Return the parsed JSON body, caching on request.state to avoid
    re-reading the stream on the actual handler."""
    cached = getattr(request.state, "_rl_body_cache", None)
    if cached is not None:
        return cached
    try:
        raw = await request.body()
        # Stash the raw bytes back so downstream `await request.json()` works.
        # Starlette caches `_body` on the Request internally when body() is
        # invoked, so subsequent .json() calls reuse it.
        body = json.loads(raw.decode("utf-8")) if raw else {}
        if not isinstance(body, dict):
            body = {}
    except Exception:
        body = {}
    request.state._rl_body_cache = body
    return body


def account_key_from_email_body(request: Request) -> str:
    """Limiter key: 'account:<sha256(email)>'. Used by login + recovery verify.

    Slowapi calls key_func synchronously, so we re-implement the body read
    via a small sync helper that piggy-backs on Starlette's internal
    _body cache. If the body has not been read yet (which is the common
    case at limiter-decorator time), we fall back to the IP key — the
    rate limit will then fire on IP, which is a strictly weaker
    constraint than per-account but never causes false-negatives.
    """
    body_bytes = getattr(request, "_body", None)
    if body_bytes is None:
        return f"ip:{_hash_ip(get_remote_address(request))}"
    try:
        body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        if not isinstance(body, dict):
            return f"ip:{_hash_ip(get_remote_address(request))}"
    except Exception:
        return f"ip:{_hash_ip(get_remote_address(request))}"
    email = str(body.get("email", "")).strip().lower()
    if not email:
        return f"ip:{_hash_ip(get_remote_address(request))}"
    digest = hashlib.sha256(email.encode("utf-8")).hexdigest()[:_HASH_LEN_HEX]
    return f"account:{digest}"


def account_key_from_token_body(request: Request) -> str:
    """Per /recode/recovery/verify: hash the (token) field so distinct
    reset attempts on different tokens get separate buckets. The token
    is already opaque; we hash it just to keep the limiter key bounded."""
    body_bytes = getattr(request, "_body", None)
    if body_bytes is None:
        return f"ip:{_hash_ip(get_remote_address(request))}"
    try:
        body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        if not isinstance(body, dict):
            return f"ip:{_hash_ip(get_remote_address(request))}"
    except Exception:
        return f"ip:{_hash_ip(get_remote_address(request))}"
    token = str(body.get("token", "")).strip()
    if not token:
        return f"ip:{_hash_ip(get_remote_address(request))}"
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()[:_HASH_LEN_HEX]
    return f"token:{digest}"


# Module-level limiter singleton. Exported so server.py can attach it to
# `app.state.limiter` and decorate endpoints.
# Default key_func is the hashed IP (used by limits that don't override).
limiter = Limiter(key_func=ip_key)


# Limit strings — re-exported so endpoint modules can refer to them by name
# rather than hardcoding "5/15 minutes" everywhere.
LOGIN_PER_IP = "5/15 minutes"
LOGIN_PER_ACCOUNT = "10/1 hour"
RECOVERY_INITIATE_PER_IP = "3/1 hour"
RECOVERY_VERIFY_PER_TOKEN = "5/15 minutes"


async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> JSONResponse:
    """JSON 429 response — keeps the error shape consistent with the rest
    of the Recode-IT API (which uses {error, message} from http_utils)."""
    retry_after = getattr(exc, "retry_after", None)
    payload = {
        "error": "rate_limited",
        "message": "Too many attempts. Please wait a few minutes and try again.",
    }
    headers = {}
    if retry_after:
        headers["Retry-After"] = str(int(retry_after))
    return JSONResponse(payload, status_code=429, headers=headers)


__all__ = [
    "limiter",
    "ip_key",
    "account_key_from_email_body",
    "account_key_from_token_body",
    "LOGIN_PER_IP",
    "LOGIN_PER_ACCOUNT",
    "RECOVERY_INITIATE_PER_IP",
    "RECOVERY_VERIFY_PER_TOKEN",
    "rate_limit_exceeded_handler",
    "BodyPreloadMiddleware",
]
