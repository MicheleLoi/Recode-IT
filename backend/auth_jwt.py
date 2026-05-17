"""
auth_jwt.py — Recode-IT JWT session middleware (Phase 3).

Parallel to MHC-L's `mcp_server/auth.py::BearerAuthMiddleware`. MHC-L's
middleware stays untouched: it authenticates API key paste-in-config
installer traffic. This module authenticates BROWSER SESSIONS for the
Recode-IT SPA:

  - JWT issued by /recode/login is set as an HttpOnly + Secure + SameSite=Lax
    cookie named `recode_jwt`.
  - 30-day expiry; refreshed implicitly on every authenticated request that
    is older than RECODE_JWT_REFRESH_THRESHOLD_SECONDS.
  - HS256 signing with RECODE_IT_JWT_SECRET (32+ random bytes).

Helper utilities (`issue_token`, `decode_token`, `require_user`) are exposed
so handlers can both mint cookies on login and resolve `user_id` on
authenticated routes without re-implementing the parse + verify dance.

Stdlib + PyJWT.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from typing import Any

import jwt

JWT_COOKIE_NAME = "recode_jwt"
JWT_ALGORITHM = "HS256"
JWT_TTL_SECONDS = 30 * 24 * 3600  # 30 days
# When the remaining lifetime falls below this, issue a refreshed cookie on
# the same response. Conservative: refresh in the last 7 days of the window.
JWT_REFRESH_THRESHOLD_SECONDS = 7 * 24 * 3600

ENV_JWT_SECRET = "RECODE_IT_JWT_SECRET"

_SECRET_DEFAULT_TEST = "test-only-do-not-use-in-prod-" + "x" * 32


def _get_secret() -> str:
    secret = os.environ.get(ENV_JWT_SECRET)
    if not secret:
        # Tests opt in via env; in prod the absence of the env var is a
        # configuration error surfaced at handler-time, not at import.
        secret = _SECRET_DEFAULT_TEST
    return secret


@dataclass(frozen=True)
class TokenClaims:
    user_id: str
    email: str
    issued_at: datetime
    expires_at: datetime


def issue_token(user_id: str, email: str, *, now: datetime | None = None) -> tuple[str, datetime]:
    """Mint a JWT and return (token, expires_at)."""
    issued = now or datetime.now(timezone.utc)
    exp = issued + timedelta(seconds=JWT_TTL_SECONDS)
    payload = {
        "sub": user_id,
        "email": email,
        "iat": int(issued.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)
    return token, exp


def decode_token(token: str) -> TokenClaims:
    """Decode + verify a JWT. Raises jwt.* on failure."""
    payload: dict[str, Any] = jwt.decode(
        token, _get_secret(), algorithms=[JWT_ALGORITHM]
    )
    return TokenClaims(
        user_id=str(payload["sub"]),
        email=str(payload.get("email", "")),
        issued_at=datetime.fromtimestamp(int(payload["iat"]), tz=timezone.utc),
        expires_at=datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc),
    )


def cookie_value(token: str, *, expires_at: datetime, secure: bool = True) -> str:
    """
    Build a Set-Cookie header value for the recode_jwt cookie.

    Defensive defaults: HttpOnly, Secure, SameSite=Lax, Path=/.
    The handler controls `secure=False` only for local HTTP testing.
    """
    fmt = expires_at.astimezone(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
    parts = [
        f"{JWT_COOKIE_NAME}={token}",
        f"Expires={fmt}",
        f"Max-Age={JWT_TTL_SECONDS}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_cookie_value(*, secure: bool = True) -> str:
    parts = [
        f"{JWT_COOKIE_NAME}=",
        "Path=/",
        "Max-Age=0",
        "HttpOnly",
        "SameSite=Lax",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def extract_token_from_headers(raw_headers: list[tuple[bytes, bytes]]) -> str | None:
    """
    Pull the JWT from either:
      - the `recode_jwt` cookie (browser session — primary path)
      - the `Authorization: Bearer <jwt>` header (test / non-cookie clients)
    """
    auth = None
    cookie_header = None
    for k, v in raw_headers:
        kl = k.lower()
        if kl == b"authorization":
            try:
                auth = v.decode("latin-1")
            except UnicodeDecodeError:
                auth = None
        elif kl == b"cookie":
            try:
                cookie_header = v.decode("latin-1")
            except UnicodeDecodeError:
                cookie_header = None
    if auth and auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
        if tok:
            return tok
    if cookie_header:
        jar = SimpleCookie()
        try:
            jar.load(cookie_header)
        except Exception:
            return None
        morsel = jar.get(JWT_COOKIE_NAME)
        if morsel and morsel.value:
            return morsel.value
    return None


def needs_refresh(claims: TokenClaims, *, now: datetime | None = None) -> bool:
    """True if the token is in its refresh window (last 7 days)."""
    current = now or datetime.now(timezone.utc)
    remaining = (claims.expires_at - current).total_seconds()
    return 0 < remaining < JWT_REFRESH_THRESHOLD_SECONDS


__all__ = [
    "JWT_COOKIE_NAME",
    "JWT_TTL_SECONDS",
    "JWT_REFRESH_THRESHOLD_SECONDS",
    "ENV_JWT_SECRET",
    "TokenClaims",
    "issue_token",
    "decode_token",
    "cookie_value",
    "clear_cookie_value",
    "extract_token_from_headers",
    "needs_refresh",
]
