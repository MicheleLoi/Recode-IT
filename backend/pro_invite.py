"""
pro_invite.py — Recode-IT Phase 1 pro-tier invite funnel.

Workflow:
  1. User free POST /recode/pro/request-invite (JWT) con `reason` (25..1000 char)
     → row pending + email "richiesta ricevuta".
  2. Founder POST /recode/admin/pro/approve (Bearer admin key) con request_id
     → genera token plain + hash; row → approved; email all'utente con link
     `/upgrade?t=<token>`.
  3. User POST /recode/pro/claim-invite con `{token}` (NO auth — il token è
     autosufficiente) → 200 con stripe_payment_link_url (+ client_reference_id).
     Il claim NON consuma il token; il consumo finale avviene nel webhook
     Stripe customer.subscription.created.
  4. (Webhook) marca row → claimed, recode_users.tier → 'pro'.

Token format:
  `<rand_base64url_32byte>.<hmac_sha256_signature_hex>`
  Signature = HMAC-SHA256(env RECODE_IT_INVITE_SECRET, rand_part).
  Verify ricostruisce sign + constant-time compare, poi cerca SHA-256(token)
  nel DB nelle righe approved con scadenza nel futuro.

Env vars:
  - RECODE_IT_INVITE_SECRET (HMAC firma token)
  - RECODE_IT_ADMIN_KEY (Bearer per /recode/admin/pro/approve)
  - RECODE_IT_PRO_STRIPE_PAYMENT_LINK_URL (URL Payment Link €0/mese)

Token lifespan: 7 giorni (configurabile via INVITE_TOKEN_TTL_DAYS).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

from starlette.requests import Request

from .db import connection
from .http_utils import error_response, json_response
from .mailer import (
    send_invite_approved_email,
    send_invite_request_received_email,
)


REASON_MIN = 25
REASON_MAX = 1000
INVITE_TOKEN_TTL_DAYS = 7
ADMIN_KEY_HEADER = "authorization"

ENV_INVITE_SECRET = "RECODE_IT_INVITE_SECRET"
ENV_ADMIN_KEY = "RECODE_IT_ADMIN_KEY"
ENV_STRIPE_PAYMENT_LINK_URL = "RECODE_IT_PRO_STRIPE_PAYMENT_LINK_URL"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _invite_secret() -> bytes:
    secret = os.environ.get(ENV_INVITE_SECRET)
    if not secret:
        # Fail loud in production. In test conftest sets a deterministic value.
        raise RuntimeError(
            f"{ENV_INVITE_SECRET} not set — cannot sign / verify invite tokens"
        )
    return secret.encode("utf-8")


def _hash_token(token_plain: str) -> str:
    return hashlib.sha256(token_plain.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Token generate / verify
# ---------------------------------------------------------------------------

def generate_invite_token(user_id: str, request_id: int) -> tuple[str, str]:
    """Return (token_plain, token_hash).

    Format: `<rand>.<sig>` where rand is 32 random bytes urlsafe-b64-encoded
    (no padding) and sig is hex HMAC-SHA256 of rand with the invite secret.

    user_id / request_id are accepted for API symmetry & future use (e.g.
    binding the signature to the row id) but the current signature scheme
    is purely "unforgeable random". The DB lookup by hash gives row → user_id.
    """
    rand = secrets.token_urlsafe(32).rstrip("=")
    sig = hmac.new(_invite_secret(), rand.encode("ascii"), hashlib.sha256).hexdigest()
    token_plain = f"{rand}.{sig}"
    return token_plain, _hash_token(token_plain)


def verify_invite_token(token_plain: str) -> dict | None:
    """Verify HMAC signature, lookup by hash, check status='approved' + not expired.

    Returns dict `{user_id, request_id, expires_at}` or None if invalid /
    expired / wrong status. Constant-time signature compare.
    """
    if not token_plain or not isinstance(token_plain, str) or "." not in token_plain:
        return None
    rand, _, sig = token_plain.partition(".")
    if not rand or not sig:
        return None
    try:
        expected_sig = hmac.new(
            _invite_secret(), rand.encode("ascii"), hashlib.sha256
        ).hexdigest()
    except RuntimeError:
        return None
    if not hmac.compare_digest(sig, expected_sig):
        return None

    token_hash = _hash_token(token_plain)
    with connection() as conn:
        row = conn.execute(
            """
            SELECT id, user_id, status, invite_token_expires_at, claimed_at
            FROM recode_pro_invite_requests
            WHERE invite_token_hash = ?
            """,
            (token_hash,),
        ).fetchone()
    if row is None:
        return None
    if row["status"] != "approved":
        return None
    # Expiry check.
    try:
        exp = datetime.fromisoformat(row["invite_token_expires_at"])
    except (TypeError, ValueError):
        return None
    if exp <= _now():
        return None
    return {
        "user_id": row["user_id"],
        "request_id": row["id"],
        "expires_at": row["invite_token_expires_at"],
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

async def request_invite_endpoint(request: Request):
    """POST /recode/pro/request-invite (JWT-protected)."""
    user_id = getattr(request.state, "user_id", None)
    email = getattr(request.state, "email", None)
    if not user_id:
        return error_response("auth_required", "Authentication required.",
                              status=401, request=request)

    try:
        payload = await request.json()
    except Exception:
        return error_response("invalid_json", "Request body must be valid JSON.",
                              status=400, request=request)
    if not isinstance(payload, dict):
        return error_response("invalid_payload", "Expected a JSON object.",
                              status=400, request=request)

    reason = str(payload.get("reason", "")).strip()
    if len(reason) < REASON_MIN:
        return error_response(
            "reason_too_short",
            f"Spiega in almeno {REASON_MIN} caratteri come pensi di usare Recode IT.",
            status=400, extra={"min_length": REASON_MIN}, request=request,
        )
    if len(reason) > REASON_MAX:
        return error_response(
            "reason_too_long",
            f"La motivazione può avere al massimo {REASON_MAX} caratteri.",
            status=400, extra={"max_length": REASON_MAX}, request=request,
        )

    # Fetch display name for email salutation.
    with connection() as conn:
        urow = conn.execute(
            "SELECT name, tier FROM recode_users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not urow:
            return error_response("user_not_found", "User not found.",
                                  status=404, request=request)
        if urow["tier"] == "pro":
            return error_response(
                "already_pro",
                "Il tuo account è già sul piano pro.",
                status=409, request=request,
            )

        # Unique partial index su (user_id) WHERE status IN ('pending','approved')
        # blocca double-pending. Restituiamo 409 con messaggio chiaro.
        try:
            cur = conn.execute(
                """
                INSERT INTO recode_pro_invite_requests
                    (user_id, reason, status, requested_at)
                VALUES (?, ?, 'pending', ?)
                """,
                (user_id, reason, _now_iso()),
            )
        except Exception as exc:
            if "UNIQUE" in str(exc).upper():
                return error_response(
                    "request_already_active",
                    "Hai già una richiesta in corso o un invito approvato. "
                    "Controlla la mail.",
                    status=409, request=request,
                )
            raise
        request_id = cur.lastrowid
        row = conn.execute(
            "SELECT requested_at FROM recode_pro_invite_requests WHERE id = ?",
            (request_id,),
        ).fetchone()
        requested_at = row["requested_at"]

    # Best-effort confirmation email.
    try:
        send_invite_request_received_email(email or "", urow["name"] or "")
    except Exception as exc:  # noqa: BLE001
        print(f"[pro_invite] request-received email failed for {email!r}: {exc!r}",
              file=sys.stderr, flush=True)

    return json_response(
        {
            "request_id": request_id,
            "status": "pending",
            "requested_at": requested_at,
        },
        status=201, request=request,
    )


async def my_request_endpoint(request: Request):
    """GET /recode/pro/my-request (JWT-protected).

    Returns the latest invite request for the current user (any status), or
    null. Used by the frontend to hydrate the "Richiedi accesso pro" section
    so a user who already submitted doesn't see the form again.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        return error_response("auth_required", "Authentication required.",
                              status=401, request=request)
    with connection() as conn:
        row = conn.execute(
            """
            SELECT id, status, requested_at, approved_at, claimed_at, rejected_at,
                   invite_token_expires_at
            FROM recode_pro_invite_requests
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
    if row is None:
        return json_response({"request": None}, status=200, request=request)
    return json_response(
        {
            "request": {
                "request_id": row["id"],
                "status": row["status"],
                "requested_at": row["requested_at"],
                "approved_at": row["approved_at"],
                "claimed_at": row["claimed_at"],
                "rejected_at": row["rejected_at"],
                "invite_expires_at": row["invite_token_expires_at"],
            }
        },
        status=200, request=request,
    )


async def admin_approve_endpoint(request: Request):
    """POST /recode/admin/pro/approve (Bearer admin key).

    Body: `{request_id: int}`. Genera token + hash, aggiorna row a status=approved,
    spedisce email. Non protetto dalla JWT-middleware (path /recode/admin/...).
    """
    # Bearer admin key check.
    expected = os.environ.get(ENV_ADMIN_KEY)
    if not expected:
        return error_response(
            "admin_key_not_configured",
            "Admin key not configured on this server.",
            status=500, request=request,
        )
    auth_header = request.headers.get("authorization", "") or ""
    if not auth_header.startswith("Bearer "):
        return error_response("admin_auth_required", "Admin Bearer token required.",
                              status=403, request=request)
    provided = auth_header[len("Bearer "):].strip()
    if not hmac.compare_digest(provided, expected):
        return error_response("invalid_admin_key", "Invalid admin key.",
                              status=403, request=request)

    try:
        payload = await request.json()
    except Exception:
        return error_response("invalid_json", "Request body must be valid JSON.",
                              status=400, request=request)
    if not isinstance(payload, dict):
        return error_response("invalid_payload", "Expected a JSON object.",
                              status=400, request=request)
    try:
        request_id = int(payload.get("request_id"))
    except (TypeError, ValueError):
        return error_response("invalid_request_id", "request_id must be an integer.",
                              status=400, request=request)

    with connection() as conn:
        row = conn.execute(
            """
            SELECT r.id, r.user_id, r.status, u.email, u.name
            FROM recode_pro_invite_requests r
            JOIN recode_users u ON u.id = r.user_id
            WHERE r.id = ?
            """,
            (request_id,),
        ).fetchone()
        if row is None:
            return error_response("request_not_found", "Invite request not found.",
                                  status=404, request=request)
        if row["status"] not in ("pending",):
            return error_response(
                "invalid_status",
                f"Cannot approve request in status={row['status']!r}; "
                "must be 'pending'.",
                status=409, request=request,
            )

        token_plain, token_hash = generate_invite_token(row["user_id"], row["id"])
        now = _now()
        expires = now + timedelta(days=INVITE_TOKEN_TTL_DAYS)
        conn.execute(
            """
            UPDATE recode_pro_invite_requests
               SET status = 'approved',
                   approved_at = ?,
                   invite_token_hash = ?,
                   invite_token_expires_at = ?
             WHERE id = ?
            """,
            (now.isoformat(), token_hash, expires.isoformat(), request_id),
        )

    # Send approval email with the plain token in the link.
    try:
        send_invite_approved_email(
            row["email"], row["name"] or "", token_plain, expires.isoformat(),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[pro_invite] approved email failed for {row['email']!r}: {exc!r}",
              file=sys.stderr, flush=True)

    return json_response(
        {
            "request_id": request_id,
            "approved_at": now.isoformat(),
            "expires_at": expires.isoformat(),
            # Plain token included for audit/test purposes; in production
            # the founder should never log this. Documented in module docstring.
            "invite_token_plain_for_audit_NEVER_LOG": token_plain,
        },
        status=200, request=request,
    )


async def claim_invite_endpoint(request: Request):
    """POST /recode/pro/claim-invite (PUBLIC — token is self-contained auth).

    Body: `{token: str}`. Returns 200 with stripe_payment_link_url + user_id
    on success. Token is NOT consumed here; consumption happens in the webhook.
    """
    try:
        payload = await request.json()
    except Exception:
        return error_response("invalid_json", "Request body must be valid JSON.",
                              status=400, request=request)
    if not isinstance(payload, dict):
        return error_response("invalid_payload", "Expected a JSON object.",
                              status=400, request=request)
    token = str(payload.get("token", ""))
    if not token:
        return error_response("missing_token", "token is required.",
                              status=400, request=request)

    verified = verify_invite_token(token)
    if verified is None:
        return error_response(
            "invalid_invite_token",
            "Invito non valido, scaduto o già utilizzato.",
            status=400, request=request,
        )

    base_url = os.environ.get(ENV_STRIPE_PAYMENT_LINK_URL)
    if not base_url:
        return error_response(
            "stripe_link_not_configured",
            "Stripe Payment Link not configured on this server.",
            status=500, request=request,
        )
    # Append client_reference_id so the webhook can map the subscription
    # back to the Recode IT user_id.
    sep = "&" if "?" in base_url else "?"
    stripe_url = f"{base_url}{sep}client_reference_id={verified['user_id']}"

    return json_response(
        {
            "stripe_payment_link_url": stripe_url,
            "user_id": verified["user_id"],
            "expires_at": verified["expires_at"],
        },
        status=200, request=request,
    )


__all__ = [
    "REASON_MIN",
    "REASON_MAX",
    "INVITE_TOKEN_TTL_DAYS",
    "ENV_INVITE_SECRET",
    "ENV_ADMIN_KEY",
    "ENV_STRIPE_PAYMENT_LINK_URL",
    "generate_invite_token",
    "verify_invite_token",
    "request_invite_endpoint",
    "my_request_endpoint",
    "admin_approve_endpoint",
    "claim_invite_endpoint",
]
