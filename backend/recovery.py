"""
recovery.py — Recode-IT password recovery flow (Phase 3).

Two-step flow:

  1. POST /recode/recovery/initiate  { email }
     - Server looks up user; if found, generates an `email_tokens` row with
       purpose='password_reset' and emails a reset link to that address.
       Response is always 200 (no enumeration oracle).
  2. POST /recode/recovery/verify    { token, recovery_code, new_password }
     - Server verifies the email token (unused, unexpired).
     - Server verifies the recovery_code against the user's unused
       bcrypt-hashed codes; marks that code as used.
     - Server hashes new_password (Argon2id) AND generates a NEW kdf_salt.
       The kdf_salt change is intentional: per DESIGN.md §5.2, recovery-code
       reset destroys all encrypted mappings (the AES master key derived
       from the old salt is no longer reachable). The server cascade-
       deletes encrypted_mappings rows for the user — by design, with a
       loud client-side warning surfaced upstream.

DESIGN.md §5.2 + R-05 in OPEN_RISKS.md govern these semantics.
"""

from __future__ import annotations

import hashlib
import sys
from datetime import datetime, timedelta, timezone

from starlette.requests import Request

from .db import connection
from .mailer import send_password_reset_email
from .http_utils import error_response, json_response
from .password import (
    WeakPasswordError,
    find_matching_code,
    generate_email_token,
    generate_kdf_salt,
    hash_password,
    validate_password_strength,
)
from .rate_limit import (
    RECOVERY_INITIATE_PER_IP,
    RECOVERY_VERIFY_PER_TOKEN,
    account_key_from_token_body,
    limiter,
)

RESET_TOKEN_TTL_HOURS = 24


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


@limiter.limit(RECOVERY_INITIATE_PER_IP)
async def initiate_recovery(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    email = _normalize_email(str(payload.get("email", "")))

    if not email:
        # Still 200 to avoid enumeration.
        return json_response({"ok": True}, status=200, request=request)

    with connection() as conn:
        row = conn.execute(
            "SELECT id, tier FROM recode_users WHERE email = ? AND status = 'active'",
            (email,),
        ).fetchone()
        if row is None:
            # No-op response — same shape as success.
            return json_response({"ok": True}, status=200, request=request)
        user_id = row["id"]
        user_tier = row["tier"]
        token = generate_email_token()
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        exp = (_now() + timedelta(hours=RESET_TOKEN_TTL_HOURS)).isoformat()
        conn.execute(
            """
            INSERT INTO recode_email_tokens (token_hash, user_id, purpose,
                                             expires_at, created_at)
            VALUES (?, ?, 'password_reset', ?, ?)
            """,
            (token_hash, user_id, exp, _now_iso()),
        )

    try:
        send_password_reset_email(to_email=email, token=token, tier=user_tier)
    except Exception as exc:  # noqa: BLE001
        print(f"[recovery] email send failed for {email}: {exc!r}",
              file=sys.stderr, flush=True)

    return json_response({"ok": True}, status=200, request=request)


@limiter.limit(RECOVERY_VERIFY_PER_TOKEN, key_func=account_key_from_token_body)
async def verify_recovery(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return error_response("invalid_json", "Request body must be valid JSON.",
                              status=400, request=request)

    token = str(payload.get("token", ""))
    code = str(payload.get("recovery_code", ""))
    new_password = str(payload.get("new_password", ""))

    if not token or not code or not new_password:
        return error_response(
            "missing_fields",
            "token, recovery_code, and new_password are all required.",
            status=400, request=request,
        )

    try:
        validate_password_strength(new_password)
    except WeakPasswordError as exc:
        return error_response("weak_password", str(exc),
                              status=400,
                              extra={"min_length": 12, "min_classes": 3},
                              request=request)

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now_iso = _now_iso()

    with connection() as conn:
        row = conn.execute(
            """
            SELECT id, user_id, expires_at, used_at
            FROM recode_email_tokens
            WHERE token_hash = ? AND purpose = 'password_reset'
            """,
            (token_hash,),
        ).fetchone()
        if row is None or row["used_at"] is not None:
            return error_response("invalid_token",
                                  "Reset token is invalid or already used.",
                                  status=400, request=request)
        if row["expires_at"] < now_iso:
            return error_response("token_expired",
                                  "Reset token has expired.",
                                  status=400, request=request)
        user_id = row["user_id"]

        # Find a matching recovery code among the user's unused codes.
        code_rows = conn.execute(
            """
            SELECT id, code_hash FROM recode_recovery_codes
            WHERE user_id = ? AND used_at IS NULL
            """,
            (user_id,),
        ).fetchall()
        match_hash = find_matching_code((r["code_hash"] for r in code_rows), code)
        if match_hash is None:
            return error_response("invalid_recovery_code",
                                  "Recovery code is invalid or already used.",
                                  status=400, request=request)

        # Mark the matching code used, the email token used, regenerate
        # password + kdf_salt, and CASCADE-DELETE all encrypted mappings
        # (they're irrecoverable under a new master key).
        matching_id = next(r["id"] for r in code_rows if r["code_hash"] == match_hash)
        conn.execute(
            "UPDATE recode_recovery_codes SET used_at = ? WHERE id = ?",
            (now_iso, matching_id),
        )
        conn.execute(
            "UPDATE recode_email_tokens SET used_at = ? WHERE id = ?",
            (now_iso, row["id"]),
        )
        new_hash = hash_password(new_password)
        new_salt = generate_kdf_salt().hex()
        conn.execute(
            "UPDATE recode_users SET password_hash = ?, kdf_salt = ? WHERE id = ?",
            (new_hash, new_salt, user_id),
        )
        del_cur = conn.execute(
            "DELETE FROM encrypted_mappings WHERE user_id = ?",
            (user_id,),
        )
        mappings_deleted = del_cur.rowcount

    return json_response(
        {
            "ok": True,
            "mappings_destroyed": mappings_deleted,
            "kdf_salt": new_salt,
            "message": (
                "Password reimpostata. Per design zero-knowledge tutti i "
                "mapping salvati sono stati eliminati: la nuova chiave non "
                "puo' decriptare i blob cifrati con la vecchia password."
            ),
        },
        status=200, request=request,
    )


__all__ = [
    "RESET_TOKEN_TTL_HOURS",
    "initiate_recovery",
    "verify_recovery",
]
