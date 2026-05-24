"""
reverse_substitution.py — Recode-IT reverse-substitution permission endpoints.

Three endpoints expose the "reverse-substitution" feature (the user pastes a
document produced by an AI containing pseudonyms; the browser performs the
inverse mapping client-side and outputs the document with real names
restored). The backend gates the permission flag; the substitution engine
lives entirely in the frontend.

  GET  /recode/reverse-substitution/permission         [JWT required]
       → {"granted": bool, "source": "paid"|"mhc_bearer"|"pro_tier"|null}

  POST /recode/reverse-substitution/claim-mhc-bearer   [JWT required]
       body: {"bearer": "mhc_live_<token>"}
       → validates Bearer against /root/.mhc-l-keystore.db (cross-DB,
         read-only). If valid: marks reverse_substitution_permitted_at NOW
         + source='mhc_bearer' + linked_mhc_user_email on caller's
         recode_users row.

  POST /recode/reverse-substitution/claim-checkout     [JWT required]
       → returns {"checkout_url": "<Stripe Payment Link URL>"}
         with client_reference_id=<recode_user_id> appended for webhook
         linking on checkout.session.completed event.

Strategic context (pricing pivot — founder ratifica SID-20260524-051552,
supersedes the earlier SID-20260523-162500 framing where the paywall was
on "view the mapping"):
  - Free (logged-in) now includes seeing AND editing the mapping.
  - Reverse-substitution is the paid feature: €20 una tantum public, free
    for users with an MHC Bearer (acquisition funnel into MHC-H).
  - Browser-side only: server NEVER touches the mapping (it lives in the
    browser IndexedDB for free tier, server-encrypted with master_key
    client-side for Pro tier). This module gates ONLY the permission flag
    that the frontend uses to unlock the reverse-substitution UI.
  - Pro tier (existing, out of direct scope) → implicit permission: GET
    permission returns granted with source='pro_tier' even without a
    persisted reverse_substitution_permitted_at.

Naming history: pre-2026-05-24 the module was `view_key.py` and the
endpoints/columns used `view_key` semantics. The rename reflects the
pricing pivot. Frontend rename is a separate task.

Cross-DB lookup security:
  - Recode-IT backend runs as root → /root/.mhc-l-keystore.db readable.
  - Open with mode=ro for safety: no accidental writes to the MHC keystore.
  - Plain Bearer (mhc_live_<…>) hashed SHA-256 before lookup; compared
    against the key_hash column of the api_keys table.

Stdlib only (sqlite3, hashlib, os, json) — no extra deps.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

from .db import connection
from .http_utils import error_response, json_response


# Env var name for the MHC-L keystore path (default: /root/.mhc-l-keystore.db
# on prod VPS; tests can override).
ENV_MHC_KEYSTORE_PATH = "MHC_KEYSTORE_PATH"
DEFAULT_MHC_KEYSTORE_PATH = "/root/.mhc-l-keystore.db"

# Env var for the reverse-substitution Stripe Payment Link (one-time payment, €20).
# Separate from the Pro tier Payment Link (subscription €0/mese).
ENV_REVERSE_SUBSTITUTION_STRIPE_URL = (
    "RECODE_IT_REVERSE_SUBSTITUTION_STRIPE_PAYMENT_LINK_URL"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_mhc_keystore_path() -> str:
    return os.environ.get(ENV_MHC_KEYSTORE_PATH, DEFAULT_MHC_KEYSTORE_PATH)


def _hash_bearer(plain: str) -> str:
    """SHA-256 hex digest of the plain bearer token.

    Matches MHC-L `mcp_server/webhook_handler.py::_hash_key()` convention so
    the hash we compute here matches the key_hash column in api_keys.
    """
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def _lookup_mhc_bearer(bearer_plain: str) -> dict[str, Any] | None:
    """Validate a Bearer plain token against MHC-L keystore.

    Returns:
        {"user_email": str, "tier": str, "status": str} if found and active.
        None if not found or inactive.

    Raises:
        FileNotFoundError if the keystore file doesn't exist (signals
        config issue, not user error).
    """
    key_hash = _hash_bearer(bearer_plain)
    path = _resolve_mhc_keystore_path()

    if not os.path.exists(path):
        raise FileNotFoundError(
            f"MHC keystore not accessible at {path!r} — check env "
            f"{ENV_MHC_KEYSTORE_PATH} and file permissions"
        )

    # Read-only attach: mode=ro prevents accidental writes to the MHC keystore.
    uri = f"file:{path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT user_email, tier, status FROM api_keys WHERE key_hash = ?",
            (key_hash,),
        ).fetchone()
        if row is None:
            return None
        return {
            "user_email": row["user_email"],
            "tier": row["tier"],
            "status": row["status"],
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Endpoint: GET /recode/reverse-substitution/permission
# ---------------------------------------------------------------------------

async def reverse_substitution_permission_endpoint(request: Request) -> JSONResponse:
    """Return current user's reverse-substitution permission state."""
    user = getattr(request.state, "user", None)
    if user is None:
        return error_response("auth_required", "Authentication required.", status=401)

    user_id = user["id"]
    with connection() as conn:
        row = conn.execute(
            """
            SELECT tier, reverse_substitution_permitted_at, reverse_substitution_source
              FROM recode_users
             WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    if row is None:
        return error_response("user_not_found", "User not found.", status=404)

    # Pro tier implies reverse-substitution (mapping is already
    # server-encrypted, the master_key lives in browser RAM, and Pro users
    # expect this UX affordance bundled).
    if row["tier"] == "pro":
        return json_response({"granted": True, "source": "pro_tier"})

    if row["reverse_substitution_permitted_at"] is not None:
        return json_response(
            {"granted": True, "source": row["reverse_substitution_source"] or "paid"}
        )

    return json_response({"granted": False, "source": None})


# ---------------------------------------------------------------------------
# Endpoint: POST /recode/reverse-substitution/claim-mhc-bearer
# ---------------------------------------------------------------------------

async def reverse_substitution_claim_mhc_bearer_endpoint(request: Request) -> JSONResponse:
    """Validate a pasted MHC Bearer and grant reverse-substitution permission if valid."""
    user = getattr(request.state, "user", None)
    if user is None:
        return error_response("auth_required", "Authentication required.", status=401)

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return error_response("invalid_json", "Request body must be valid JSON.", status=400)

    bearer = body.get("bearer") if isinstance(body, dict) else None
    if not bearer or not isinstance(bearer, str):
        return error_response("bearer_required", "Bearer key required.", status=400)

    bearer = bearer.strip()
    if not bearer.startswith("mhc_live_") or len(bearer) < 16:
        return error_response("bearer_format_invalid", "Bearer key format invalid.", status=400)

    try:
        mhc_user = _lookup_mhc_bearer(bearer)
    except FileNotFoundError as exc:
        print(
            f"[recode-reverse-substitution] cross-DB lookup failed (config): {exc!r}",
            file=sys.stderr,
        )
        return error_response("keystore_unavailable", "Keystore unavailable.", status=500)
    except sqlite3.Error as exc:
        print(
            f"[recode-reverse-substitution] cross-DB SQLite error: {exc!r}",
            file=sys.stderr,
        )
        return error_response("keystore_error", "Keystore error.", status=500)

    if mhc_user is None:
        return error_response("bearer_invalid", "Bearer key invalid.", status=401)

    if mhc_user["status"] != "active":
        return error_response(
            "bearer_inactive",
            "Bearer key inactive.",
            status=401,
            extra={"detail": f"key status: {mhc_user['status']}"},
        )

    # Grant permission on current Recode user.
    user_id = user["id"]
    now = _now_iso()
    with connection() as conn:
        conn.execute(
            """
            UPDATE recode_users
               SET reverse_substitution_permitted_at = ?,
                   reverse_substitution_source = 'mhc_bearer',
                   linked_mhc_user_email = ?
             WHERE id = ?
            """,
            (now, mhc_user["user_email"], user_id),
        )

    print(
        f"[recode-reverse-substitution] mhc_bearer claim ok: recode_user_id={user_id!r} "
        f"linked_email={mhc_user['user_email']!r} mhc_tier={mhc_user['tier']!r}",
        file=sys.stderr,
    )

    return json_response({"granted": True, "source": "mhc_bearer"})


# ---------------------------------------------------------------------------
# Endpoint: POST /recode/reverse-substitution/claim-checkout
# ---------------------------------------------------------------------------

async def reverse_substitution_claim_checkout_endpoint(request: Request) -> JSONResponse:
    """Return the Stripe Payment Link URL for the €20 reverse-substitution add-on.

    Appends ?client_reference_id=<recode_user_id> so the webhook
    (checkout.session.completed) can link the payment to the user.
    """
    user = getattr(request.state, "user", None)
    if user is None:
        return error_response("auth_required", "Authentication required.", status=401)

    base_url = os.environ.get(ENV_REVERSE_SUBSTITUTION_STRIPE_URL, "").strip()
    if not base_url:
        print(
            f"[recode-reverse-substitution] {ENV_REVERSE_SUBSTITUTION_STRIPE_URL} not set",
            file=sys.stderr,
        )
        return error_response("reverse_substitution_stripe_url_not_configured", "Reverse substitution Stripe URL not configured.", status=500)

    # If already granted, no need to send to Stripe — return current state.
    user_id = user["id"]
    with connection() as conn:
        row = conn.execute(
            """
            SELECT tier, reverse_substitution_permitted_at
              FROM recode_users
             WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    if row is None:
        return error_response("user_not_found", "User not found.", status=404)

    if row["tier"] == "pro" or row["reverse_substitution_permitted_at"] is not None:
        return json_response(
            {"already_granted": True, "checkout_url": None}
        )

    # Append client_reference_id query param (Stripe Payment Link supports
    # this for funnel attribution).
    sep = "&" if "?" in base_url else "?"
    checkout_url = f"{base_url}{sep}client_reference_id={user_id}"

    return json_response(
        {"already_granted": False, "checkout_url": checkout_url}
    )


__all__ = [
    "reverse_substitution_permission_endpoint",
    "reverse_substitution_claim_mhc_bearer_endpoint",
    "reverse_substitution_claim_checkout_endpoint",
    "ENV_MHC_KEYSTORE_PATH",
    "ENV_REVERSE_SUBSTITUTION_STRIPE_URL",
]
