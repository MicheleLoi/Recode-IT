"""
view_key.py — Recode-IT view-key permission endpoints.

Three endpoints expose the "vedi la chiave" feature (UI button that displays
the pseudonymization mapping to the user for debugging NER errors):

  GET  /recode/view-key/permission         [JWT required]
       → {"granted": bool, "source": "paid"|"mhc_bearer"|"pro_tier"|null}

  POST /recode/view-key/claim-mhc-bearer   [JWT required]
       body: {"bearer": "mhc_live_<token>"}
       → validates Bearer against /root/.mhc-l-keystore.db (cross-DB,
         read-only). If valid: marks view_key_permitted_at NOW + source=
         'mhc_bearer' + linked_mhc_user_email on caller's recode_users row.

  POST /recode/view-key/claim-checkout     [JWT required]
       → returns {"checkout_url": "<Stripe Payment Link URL>"}
         with client_reference_id=<recode_user_id> appended for webhook
         linking on checkout.session.completed event.

Strategic context (founder ratifica SID-20260523-162500):
  - View-key è add-on €20 una tantum, free per chi ha Bearer MHC.
  - Browser-side only: server NON tocca mai la mapping (vive in IndexedDB
    del browser per tier free, server-encrypted con master_key client-side
    per tier pro). Questo modulo gates SOLO il permission flag UI.
  - Pro tier (esistente, fuori scope diretto) → permission implicita: GET
    permission ritorna granted con source='pro_tier' anche senza
    view_key_permitted_at persistito.

Cross-DB lookup security:
  - Recode-IT backend gira come root → file /root/.mhc-l-keystore.db
    accessibile in lettura.
  - Apertura con mode=ro (read-only) per safety: nessuna modifica
    accidentale al keystore MHC.
  - Bearer plain (mhc_live_<…>) hashato SHA-256 prima del lookup;
    confronto con colonna key_hash della tabella api_keys.

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

# Env var for the view-key Stripe Payment Link (one-time payment, €20).
# Separate from the Pro tier Payment Link (subscription €0/mese).
ENV_VIEW_KEY_STRIPE_URL = "RECODE_IT_VIEW_KEY_STRIPE_PAYMENT_LINK_URL"


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
# Endpoint: GET /recode/view-key/permission
# ---------------------------------------------------------------------------

async def view_key_permission_endpoint(request: Request) -> JSONResponse:
    """Return current user's view-key permission state."""
    user = getattr(request.state, "user", None)
    if user is None:
        return error_response(401, "auth_required")

    user_id = user["id"]
    with connection() as conn:
        row = conn.execute(
            """
            SELECT tier, view_key_permitted_at, view_key_source
              FROM recode_users
             WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    if row is None:
        return error_response(404, "user_not_found")

    # Pro tier implies view-key (mapping is already server-encrypted, the
    # master_key lives in browser RAM, and Pro users expect this UX
    # affordance bundled).
    if row["tier"] == "pro":
        return json_response({"granted": True, "source": "pro_tier"})

    if row["view_key_permitted_at"] is not None:
        return json_response(
            {"granted": True, "source": row["view_key_source"] or "paid"}
        )

    return json_response({"granted": False, "source": None})


# ---------------------------------------------------------------------------
# Endpoint: POST /recode/view-key/claim-mhc-bearer
# ---------------------------------------------------------------------------

async def view_key_claim_mhc_bearer_endpoint(request: Request) -> JSONResponse:
    """Validate a pasted MHC Bearer and grant view-key permission if valid."""
    user = getattr(request.state, "user", None)
    if user is None:
        return error_response(401, "auth_required")

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return error_response(400, "invalid_json")

    bearer = body.get("bearer") if isinstance(body, dict) else None
    if not bearer or not isinstance(bearer, str):
        return error_response(400, "bearer_required")

    bearer = bearer.strip()
    if not bearer.startswith("mhc_live_") or len(bearer) < 16:
        return error_response(400, "bearer_format_invalid")

    try:
        mhc_user = _lookup_mhc_bearer(bearer)
    except FileNotFoundError as exc:
        print(
            f"[recode-view-key] cross-DB lookup failed (config): {exc!r}",
            file=sys.stderr,
        )
        return error_response(500, "keystore_unavailable")
    except sqlite3.Error as exc:
        print(
            f"[recode-view-key] cross-DB SQLite error: {exc!r}",
            file=sys.stderr,
        )
        return error_response(500, "keystore_error")

    if mhc_user is None:
        return error_response(401, "bearer_invalid")

    if mhc_user["status"] != "active":
        return error_response(
            401, "bearer_inactive",
            extra={"detail": f"key status: {mhc_user['status']}"},
        )

    # Grant permission on current Recode user.
    user_id = user["id"]
    now = _now_iso()
    with connection() as conn:
        conn.execute(
            """
            UPDATE recode_users
               SET view_key_permitted_at = ?,
                   view_key_source = 'mhc_bearer',
                   linked_mhc_user_email = ?
             WHERE id = ?
            """,
            (now, mhc_user["user_email"], user_id),
        )

    print(
        f"[recode-view-key] mhc_bearer claim ok: recode_user_id={user_id!r} "
        f"linked_email={mhc_user['user_email']!r} mhc_tier={mhc_user['tier']!r}",
        file=sys.stderr,
    )

    return json_response({"granted": True, "source": "mhc_bearer"})


# ---------------------------------------------------------------------------
# Endpoint: POST /recode/view-key/claim-checkout
# ---------------------------------------------------------------------------

async def view_key_claim_checkout_endpoint(request: Request) -> JSONResponse:
    """Return the Stripe Payment Link URL for the €20 view-key add-on.

    Appends ?client_reference_id=<recode_user_id> so the webhook
    (checkout.session.completed) can link the payment to the user.
    """
    user = getattr(request.state, "user", None)
    if user is None:
        return error_response(401, "auth_required")

    base_url = os.environ.get(ENV_VIEW_KEY_STRIPE_URL, "").strip()
    if not base_url:
        print(
            f"[recode-view-key] {ENV_VIEW_KEY_STRIPE_URL} not set",
            file=sys.stderr,
        )
        return error_response(500, "view_key_stripe_url_not_configured")

    # If already granted, no need to send to Stripe — return current state.
    user_id = user["id"]
    with connection() as conn:
        row = conn.execute(
            """
            SELECT tier, view_key_permitted_at
              FROM recode_users
             WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    if row is None:
        return error_response(404, "user_not_found")

    if row["tier"] == "pro" or row["view_key_permitted_at"] is not None:
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
    "view_key_permission_endpoint",
    "view_key_claim_mhc_bearer_endpoint",
    "view_key_claim_checkout_endpoint",
    "ENV_MHC_KEYSTORE_PATH",
    "ENV_VIEW_KEY_STRIPE_URL",
]
