"""
login.py — Recode-IT POST /recode/login + POST /recode/logout (Phase 3).

Login:
  - Validate email + password.
  - Verify password against Argon2id hash.
  - Issue JWT, set as HttpOnly + Secure + SameSite=Lax cookie (30 days).
  - Return user info + kdf_salt (client needs it to derive the AES-GCM
    master key on its side).

Generic "invalid credentials" error for both wrong email and wrong password
to avoid an enumeration oracle.

Logout: clear the cookie.

GET /recode/me: returns current user info (used by the SPA on hydration).
"""

from __future__ import annotations

from datetime import datetime, timezone

from starlette.requests import Request

from .auth_jwt import (
    clear_cookie_value,
    cookie_value,
    issue_token,
)
from .db import connection
from .http_utils import error_response, json_response
from .password import hash_password, verify_password

# Toggle for HTTP-only local dev (when set, Set-Cookie omits Secure flag).
import os
_COOKIE_SECURE_DEFAULT = os.environ.get("RECODE_IT_COOKIE_SECURE", "1") != "0"

# P6 timing-attack mitigation: when the user lookup misses we still pay the
# Argon2id verify cost so the response time does not leak account existence.
# Computed once at import; the password we compare against never matches any
# real plaintext (it's the hash of a random ephemeral string).
import secrets as _secrets
_DUMMY_PASSWORD_HASH = hash_password(_secrets.token_urlsafe(32))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


async def login_endpoint(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return error_response("invalid_json", "Request body must be valid JSON.",
                              status=400, request=request)
    if not isinstance(payload, dict):
        return error_response("invalid_payload", "Expected a JSON object.",
                              status=400, request=request)

    email = _normalize_email(str(payload.get("email", "")))
    password = str(payload.get("password", ""))

    if not email or not password:
        return error_response(
            "invalid_credentials",
            "Invalid email or password.",
            status=401, request=request,
        )

    with connection() as conn:
        row = conn.execute(
            """
            SELECT id, email, password_hash, kdf_salt, email_verified, status
            FROM recode_users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()

    # P6 timing-attack mitigation: always run verify_password (against the
    # real hash if the user exists, against a dummy hash otherwise) so the
    # response time does not leak account existence. Compute the boolean
    # outcome first, then collapse the two failure paths into one generic
    # error.
    if row is None or row["status"] != "active":
        # Spend the verify cost on a hash that will never match.
        verify_password(_DUMMY_PASSWORD_HASH, password)
        return error_response(
            "invalid_credentials",
            "Invalid email or password.",
            status=401, request=request,
        )

    if not verify_password(row["password_hash"], password):
        return error_response(
            "invalid_credentials",
            "Invalid email or password.",
            status=401, request=request,
        )

    user_id = row["id"]
    user_email = row["email"]

    token, expires_at = issue_token(user_id, user_email)
    cookie = cookie_value(token, expires_at=expires_at, secure=_COOKIE_SECURE_DEFAULT)

    with connection() as conn:
        conn.execute(
            "UPDATE recode_users SET last_login_at = ? WHERE id = ?",
            (_now_iso(), user_id),
        )

    return json_response(
        {
            "user_id": user_id,
            "email": user_email,
            "kdf_salt": row["kdf_salt"],
            "email_verified": bool(row["email_verified"]),
            "expires_at": expires_at.isoformat(),
        },
        status=200,
        cookie=cookie,
        request=request,
    )


async def logout_endpoint(request: Request):
    cookie = clear_cookie_value(secure=_COOKIE_SECURE_DEFAULT)
    return json_response({"ok": True}, status=200, cookie=cookie, request=request)


async def me_endpoint(request: Request):
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        return error_response("auth_required", "Authentication required.",
                              status=401, request=request)
    with connection() as conn:
        row = conn.execute(
            """
            SELECT id, email, kdf_salt, email_verified, created_at,
                   tier, name, marketing_consent
            FROM recode_users WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    if not row:
        return error_response("user_not_found", "User no longer exists.",
                              status=404, request=request)
    return json_response(
        {
            "user_id": row["id"],
            "email": row["email"],
            "kdf_salt": row["kdf_salt"],
            "email_verified": bool(row["email_verified"]),
            "created_at": row["created_at"],
            "tier": row["tier"],
            "name": row["name"],
            "marketing_consent": bool(row["marketing_consent"]),
        },
        status=200, request=request,
    )


__all__ = ["login_endpoint", "logout_endpoint", "me_endpoint"]
