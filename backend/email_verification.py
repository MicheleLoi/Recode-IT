"""
email_verification.py — Recode-IT email verification + marketing consent
endpoints (capabilities_index §9 — zero-euro tier).

Two endpoints:

  GET /recode/verify-email/{token}
      The user clicks the link mailed at signup. We hash the path-token,
      look it up in recode_email_tokens, and:
        - mark email_verified=1 on the user,
        - if token.purpose was 'email_verification_with_marketing', flip
          marketing_consent=1 + stamp marketing_consent_verified_at,
        - mark the token used,
        - reply with HTML 302 Location → /?verified=1 (no JSON: this is
          opened in a browser tab from a mail client, not via fetch).

  POST/DELETE /recode/me/marketing-consent
      JWT-protected. Subscribe / unsubscribe to the newsletter post-signup
      (i.e. the user toggles the box from their account dashboard rather
      than at signup-time). POST sets both flag+verified_at; DELETE clears
      the flag (preserves the historical verified_at as a paper trail).

Token-hash lookup mirrors signup.py (SHA-256 of the URL-safe token), which
keeps the DB-side rows opaque to anyone who reads them.
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timezone

from starlette.requests import Request
from starlette.responses import RedirectResponse

from .db import connection
from .http_utils import cors_headers, error_response, json_response


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _frontend_base_url() -> str:
    """Return the SPA origin we redirect to after a verify-email click.

    Falls back to RECODE_IT_BASE_URL (the same env mailer.py uses for the link
    construction) so dev and prod stay aligned.
    """
    return os.environ.get("RECODE_IT_BASE_URL", "https://recode.micheleloi.pro").rstrip("/")


async def verify_email_endpoint(request: Request):
    """GET /recode/verify-email/{token}: confirm the address, redirect to SPA."""
    token = request.path_params.get("token", "")
    if not token:
        return error_response(
            "invalid_token", "Verification token missing.",
            status=400, request=request,
        )
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = _now_iso()

    with connection() as conn:
        row = conn.execute(
            """
            SELECT id, user_id, purpose, expires_at, used_at
            FROM recode_email_tokens WHERE token_hash = ?
            """,
            (token_hash,),
        ).fetchone()

        if not row:
            return error_response(
                "invalid_token", "Verification token not found.",
                status=404, request=request,
            )
        if row["used_at"]:
            return error_response(
                "token_already_used",
                "This verification link has already been used.",
                status=410, request=request,
            )
        if row["expires_at"] < now:
            return error_response(
                "token_expired",
                "This verification link has expired (24h).",
                status=410, request=request,
            )
        if row["purpose"] not in (
            "email_verification",
            "email_verification_with_marketing",
        ):
            return error_response(
                "wrong_purpose",
                "Token is not an email verification token.",
                status=400, request=request,
            )

        # Mark the user email_verified + (optionally) marketing_consent.
        if row["purpose"] == "email_verification_with_marketing":
            conn.execute(
                """
                UPDATE recode_users
                   SET email_verified = 1,
                       marketing_consent = 1,
                       marketing_consent_verified_at = ?
                 WHERE id = ?
                """,
                (now, row["user_id"]),
            )
        else:
            conn.execute(
                "UPDATE recode_users SET email_verified = 1 WHERE id = ?",
                (row["user_id"],),
            )
        # Burn the token (single-use).
        conn.execute(
            "UPDATE recode_email_tokens SET used_at = ? WHERE id = ?",
            (now, row["id"]),
        )

    target = f"{_frontend_base_url()}/?verified=1"
    response = RedirectResponse(url=target, status_code=302)
    # CORS isn't strictly needed for a top-level navigation but stays
    # consistent with the rest of /recode/*.
    for k, v in cors_headers(request).items():
        response.headers[k] = v
    return response


async def marketing_consent_endpoint(request: Request):
    """POST/DELETE /recode/me/marketing-consent — opt-in / opt-out post-signup."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        return error_response("auth_required", "Authentication required.",
                              status=401, request=request)
    now = _now_iso()
    method = request.method.upper()
    if method == "POST":
        with connection() as conn:
            conn.execute(
                """
                UPDATE recode_users
                   SET marketing_consent = 1,
                       marketing_consent_verified_at = ?
                 WHERE id = ?
                """,
                (now, user_id),
            )
        return json_response(
            {"marketing_consent": True, "verified_at": now},
            status=200, request=request,
        )
    if method == "DELETE":
        with connection() as conn:
            conn.execute(
                """
                UPDATE recode_users SET marketing_consent = 0 WHERE id = ?
                """,
                (user_id,),
            )
        return json_response(
            {"marketing_consent": False},
            status=200, request=request,
        )
    return error_response(
        "method_not_allowed",
        f"Method {method} not allowed on this endpoint.",
        status=405, request=request,
    )


__all__ = ["verify_email_endpoint", "marketing_consent_endpoint"]
