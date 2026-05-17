"""
signup.py — Recode-IT POST /recode/signup endpoint (Phase 3).

Flow:
  1. Validate email + password (length ≥ 12).
  2. Reject duplicate email (DB UNIQUE constraint).
  3. Argon2id-hash the password.
  4. Generate 16-byte kdf_salt (returned to client, used for CLIENT-side
     Argon2id KDF that derives the AES-GCM master key).
  5. Generate 10 recovery codes; store bcrypt(code) per row.
  6. Send email verification token (best-effort; not blocking on response).
  7. Return the recovery codes ONCE (server never re-emits them).

The kdf_salt is *not* secret — possession alone gains nothing without the
user's password. It's public DB state, identical to MHC-L's signup
behaviour for symmetric stored secrets.
"""

from __future__ import annotations

import sqlite3
import sys
import uuid
from datetime import datetime, timezone

from starlette.requests import Request

from .db import connection
from .mailer import send_verification_email
from .http_utils import error_response, json_response
from .password import (
    WeakPasswordError,
    generate_email_token,
    generate_kdf_salt,
    generate_recovery_codes,
    hash_password,
    hash_recovery_code,
    validate_password_strength,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


def _is_email_well_formed(email: str) -> bool:
    if not email or "@" not in email or " " in email:
        return False
    local, _, domain = email.partition("@")
    return bool(local) and bool(domain) and "." in domain


async def signup_endpoint(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return error_response(
            "invalid_json", "Request body must be valid JSON.",
            status=400, request=request,
        )

    if not isinstance(payload, dict):
        return error_response(
            "invalid_payload", "Expected a JSON object.",
            status=400, request=request,
        )

    email = _normalize_email(str(payload.get("email", "")))
    password = str(payload.get("password", ""))

    if not _is_email_well_formed(email):
        return error_response(
            "invalid_email", "Email format is not valid.",
            status=400, request=request,
        )

    try:
        validate_password_strength(password)
    except WeakPasswordError as exc:
        return error_response(
            "weak_password", str(exc),
            status=400, extra={"min_length": 12}, request=request,
        )

    user_id = str(uuid.uuid4())
    pw_hash = hash_password(password)
    kdf_salt = generate_kdf_salt().hex()
    recovery_codes = generate_recovery_codes(10)
    code_hashes = [hash_recovery_code(c) for c in recovery_codes]
    now = _now_iso()

    with connection() as conn:
        try:
            conn.execute(
                """
                INSERT INTO recode_users (id, email, password_hash, kdf_salt,
                                          email_verified, status, created_at)
                VALUES (?, ?, ?, ?, 0, 'active', ?)
                """,
                (user_id, email, pw_hash, kdf_salt, now),
            )
        except sqlite3.IntegrityError:
            return error_response(
                "email_already_registered",
                "An account with this email already exists.",
                status=409, request=request,
            )
        for h in code_hashes:
            conn.execute(
                """
                INSERT INTO recode_recovery_codes (user_id, code_hash, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, h, now),
            )
        # Email verification token (best-effort).
        verify_token = generate_email_token()
        import hashlib
        token_hash = hashlib.sha256(verify_token.encode("utf-8")).hexdigest()
        # 24h expiry.
        from datetime import timedelta
        exp = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
        conn.execute(
            """
            INSERT INTO recode_email_tokens (token_hash, user_id, purpose,
                                             expires_at, created_at)
            VALUES (?, ?, 'email_verification', ?, ?)
            """,
            (token_hash, user_id, exp, now),
        )

    try:
        send_verification_email(email, verify_token)
    except Exception as exc:  # noqa: BLE001 - non-fatal
        print(f"[signup] verification email send failed for {email}: {exc!r}",
              file=sys.stderr, flush=True)

    return json_response(
        {
            "user_id": user_id,
            "email": email,
            "kdf_salt": kdf_salt,
            "recovery_codes": recovery_codes,
            "warning": (
                "Salva subito i codici di recupero — non saranno mostrati "
                "di nuovo. Se perdi sia la password sia i codici, i tuoi "
                "mapping salvati saranno irrecuperabili."
            ),
        },
        status=201,
        request=request,
    )


__all__ = ["signup_endpoint"]
