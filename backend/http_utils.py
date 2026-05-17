"""
http_utils.py — Recode-IT Starlette response helpers (Phase 3).

Thin wrappers around starlette.responses.JSONResponse that:
  - normalize error payload shape ({"error": "...", "message": "..."})
  - centralize CORS headers for the SPA origin
  - centralize cookie-setting for JWT auth

The CORS policy targets the `recode.micheleloi.pro` (TBD) subdomain plus a
local dev fallback. Production wiring will set RECODE_IT_ALLOWED_ORIGIN
explicitly; tests use a permissive default.
"""

from __future__ import annotations

import os
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response


ENV_ALLOWED_ORIGIN = "RECODE_IT_ALLOWED_ORIGIN"
DEFAULT_ALLOWED_ORIGIN = "http://localhost:5173"


def allowed_origin() -> str:
    return os.environ.get(ENV_ALLOWED_ORIGIN, DEFAULT_ALLOWED_ORIGIN)


def cors_headers(request: Request | None = None) -> dict[str, str]:
    origin = None
    if request is not None:
        origin = request.headers.get("origin")
    if origin and origin == allowed_origin():
        ao = origin
    else:
        ao = allowed_origin()
    return {
        "Access-Control-Allow-Origin": ao,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Vary": "Origin",
    }


def json_response(
    body: dict[str, Any],
    *,
    status: int = 200,
    cookie: str | None = None,
    request: Request | None = None,
) -> JSONResponse:
    response = JSONResponse(body, status_code=status)
    for k, v in cors_headers(request).items():
        response.headers[k] = v
    if cookie:
        response.headers["Set-Cookie"] = cookie
    return response


def error_response(
    error: str,
    message: str,
    *,
    status: int,
    extra: dict[str, Any] | None = None,
    request: Request | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {"error": error, "message": message}
    if extra:
        body.update(extra)
    return json_response(body, status=status, request=request)


async def options_preflight(request: Request) -> Response:
    """Generic CORS preflight handler for any /recode/* route."""
    response = Response(status_code=204)
    for k, v in cors_headers(request).items():
        response.headers[k] = v
    response.headers["Access-Control-Max-Age"] = "86400"
    return response


__all__ = [
    "ENV_ALLOWED_ORIGIN",
    "DEFAULT_ALLOWED_ORIGIN",
    "allowed_origin",
    "cors_headers",
    "json_response",
    "error_response",
    "options_preflight",
]
