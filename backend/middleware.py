"""
middleware.py — Recode-IT JWT auth middleware (Phase 3).

Starlette middleware that, on configured protected route prefixes:
  1. Extracts the JWT from `recode_jwt` cookie or `Authorization: Bearer`
  2. Verifies + decodes via auth_jwt.decode_token
  3. Attaches `request.state.user_id` and `request.state.email`
  4. Optionally refreshes the cookie if it's within the refresh window

Unprotected routes (signup, login, recovery initiate/verify, options) pass
straight through.

Separate from MHC-L's BearerAuthMiddleware — that one stays in mcp_server/
and continues to gate API-key installer traffic.
"""

from __future__ import annotations

from typing import Iterable

import jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .auth_jwt import (
    cookie_value,
    decode_token,
    extract_token_from_headers,
    issue_token,
    needs_refresh,
)
from .http_utils import error_response


PROTECTED_PREFIXES_DEFAULT: tuple[str, ...] = (
    "/recode/mappings",
    "/recode/account",
    "/recode/me",
    "/recode/false-positives",
)


class RecodeJWTAuthMiddleware(BaseHTTPMiddleware):
    """Gate /recode/mappings, /recode/account, /recode/me with JWT."""

    def __init__(
        self,
        app,
        protected_prefixes: Iterable[str] | None = None,
        cookie_secure: bool = True,
    ) -> None:
        super().__init__(app)
        self.protected_prefixes = tuple(
            protected_prefixes if protected_prefixes is not None
            else PROTECTED_PREFIXES_DEFAULT
        )
        self.cookie_secure = cookie_secure

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path or ""
        if request.method == "OPTIONS":
            return await call_next(request)

        if not any(path.startswith(p) for p in self.protected_prefixes):
            return await call_next(request)

        raw_headers = [(k.encode("latin-1"), v.encode("latin-1"))
                       for k, v in request.headers.items()]
        token = extract_token_from_headers(raw_headers)
        if not token:
            return error_response(
                "auth_required",
                "Authentication required.",
                status=401,
                request=request,
            )
        try:
            claims = decode_token(token)
        except jwt.ExpiredSignatureError:
            return error_response(
                "token_expired",
                "Session expired. Please log in again.",
                status=401,
                request=request,
            )
        except jwt.InvalidTokenError:
            return error_response(
                "invalid_token",
                "Invalid session token.",
                status=401,
                request=request,
            )

        request.state.user_id = claims.user_id
        request.state.email = claims.email

        response = await call_next(request)

        if needs_refresh(claims):
            new_token, new_exp = issue_token(claims.user_id, claims.email)
            response.headers["Set-Cookie"] = cookie_value(
                new_token, expires_at=new_exp, secure=self.cookie_secure
            )

        return response


__all__ = ["RecodeJWTAuthMiddleware", "PROTECTED_PREFIXES_DEFAULT"]
