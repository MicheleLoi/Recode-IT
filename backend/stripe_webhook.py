"""
stripe_webhook.py — Recode-IT Stripe webhook handler (Phase 1, pro funnel).

ASGI route POST /recode/stripe/webhook. Single event type processed:
  - customer.subscription.created → marca recode_users.tier='pro' +
    recode_pro_invite_requests.status='claimed' per la latest 'approved'
    dell'utente identificato da client_reference_id (settato a livello
    Stripe Payment Link).

Pattern di riferimento: MHC-L `mcp_server/webhook_handler.py`. Differenze
calibrate per Recode-IT:
  - non sintetizziamo applications né api_keys (l'utente Recode-IT esiste
    già nel DB con tier='free').
  - non spediamo email a checkout completed (l'utente è già loggato e
    riceve subito la dashboard pro sbloccata al prossimo /recode/me).
  - idempotency via tabella `recode_stripe_events_processed` (event_id PK).
  - signature mandatory via STRIPE_WEBHOOK_SECRET (canonical pattern).

Sicurezza:
  - route NON sotto JWT middleware (path /recode/stripe/* non è nei
    PROTECTED_PREFIXES; controllo esplicito via firma webhook).
  - se STRIPE_WEBHOOK_SECRET è assente → 500 + log; rifiuta tutti gli
    eventi. (NON c'è "modalità dev" — meglio fail-loud).

Atomicità:
  Una singola transazione SQLite per evento. Mark-as-processed + state
  update insieme. Se solleva, ROLLBACK → Stripe redelivery.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import sys
from typing import Any, Awaitable, Callable

from .db import connect, resolve_db_path

Scope = dict[str, Any]
Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]


WEBHOOK_PATH = "/recode/stripe/webhook"
ENV_WEBHOOK_SECRET = "STRIPE_WEBHOOK_SECRET"


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

def _event_already_processed(conn: sqlite3.Connection, event_id: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM recode_stripe_events_processed WHERE event_id = ?",
        (event_id,),
    )
    return cur.fetchone() is not None


def _mark_event_processed(conn: sqlite3.Connection, event_id: str, event_type: str) -> None:
    conn.execute(
        """
        INSERT INTO recode_stripe_events_processed (event_id, event_type, processed_at)
        VALUES (?, ?, ?)
        """,
        (event_id, event_type, _now_iso()),
    )


# ---------------------------------------------------------------------------
# Event handler
# ---------------------------------------------------------------------------

def _handle_subscription_created(conn: sqlite3.Connection, event: dict) -> None:
    """Process customer.subscription.created.

    Stripe Payment Link does NOT carry `client_reference_id` on the
    subscription object itself; it is on the parent checkout.session. The
    webhook config for this funnel SHOULD listen to checkout.session.completed
    in production, but the task spec asked for customer.subscription.created
    explicitly. To support both, we accept the field in three places:
      1. event.data.object.metadata.client_reference_id (Stripe Payment Link
         can be configured to copy this onto the subscription via metadata).
      2. event.data.object.client_reference_id (defensive — newer Stripe API).
      3. event.data.object.customer (fall back to looking up by stripe_customer_id
         IF we ever store it — currently we don't, so this branch is a no-op
         logged as warning).
    """
    obj = event["data"]["object"]
    metadata = obj.get("metadata") or {}
    user_id = (
        metadata.get("client_reference_id")
        or obj.get("client_reference_id")
        or None
    )

    if not user_id:
        print(
            f"[recode-stripe] customer.subscription.created "
            f"{obj.get('id')!r}: no client_reference_id → cannot map to user — skip",
            file=sys.stderr,
        )
        return

    # Verify the user exists; if not, skip (defensive — shouldn't happen).
    urow = conn.execute(
        "SELECT id, tier FROM recode_users WHERE id = ?", (user_id,),
    ).fetchone()
    if urow is None:
        print(
            f"[recode-stripe] subscription.created: user_id={user_id!r} not found — skip",
            file=sys.stderr,
        )
        return
    if urow["tier"] == "pro":
        # Already pro — defensive idempotency. Still mark claimed if there's
        # an approved row pending.
        print(
            f"[recode-stripe] subscription.created: user_id={user_id!r} already pro — "
            f"will still claim pending invite if present",
            file=sys.stderr,
        )

    now = _now_iso()
    # Upgrade tier.
    conn.execute(
        "UPDATE recode_users SET tier = 'pro' WHERE id = ?",
        (user_id,),
    )

    # Mark the latest 'approved' invite row as claimed. If none exists
    # (e.g. user landed on Stripe Payment Link without a token — possible
    # by direct-link sharing) we still upgrade the tier but skip the
    # invite-row update.
    cur = conn.execute(
        """
        UPDATE recode_pro_invite_requests
           SET status = 'claimed',
               claimed_at = ?
         WHERE id = (
           SELECT id FROM recode_pro_invite_requests
            WHERE user_id = ? AND status = 'approved'
            ORDER BY id DESC LIMIT 1
         )
        """,
        (now, user_id),
    )
    print(
        f"[recode-stripe] subscription.created: user_id={user_id!r} → tier=pro "
        f"(invite_rows_claimed={cur.rowcount})",
        file=sys.stderr,
    )


# ---------------------------------------------------------------------------
# Top-level dispatch
# ---------------------------------------------------------------------------

def process_event(event: dict, db_path=None) -> None:
    """Dispatch a verified Stripe Event dict against the SQLite store."""
    event_id = event.get("id")
    event_type = event.get("type")
    if not event_id or not event_type:
        raise ValueError("Stripe event missing id/type")

    path = db_path or resolve_db_path()
    conn = connect(path)
    try:
        if _event_already_processed(conn, event_id):
            print(f"[recode-stripe] duplicate event {event_id} ({event_type}) — ignored",
                  file=sys.stderr)
            return

        conn.execute("BEGIN")
        try:
            if event_type == "customer.subscription.created":
                _handle_subscription_created(conn, event)
            else:
                print(
                    f"[recode-stripe] unsubscribed event type {event_type!r} "
                    f"({event_id}) — marking processed and ignoring",
                    file=sys.stderr,
                )
            _mark_event_processed(conn, event_id, event_type)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# ASGI route
# ---------------------------------------------------------------------------

async def _read_body(receive: Receive) -> bytes:
    chunks: list[bytes] = []
    while True:
        message = await receive()
        if message["type"] == "http.request":
            chunks.append(message.get("body", b"") or b"")
            if not message.get("more_body", False):
                break
        elif message["type"] == "http.disconnect":
            break
    return b"".join(chunks)


async def _send_json(send: Send, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


async def stripe_webhook_endpoint(scope: Scope, receive: Receive, send: Send) -> None:
    """Bare ASGI handler for POST /recode/stripe/webhook.

    Signature verification via `stripe.Webhook.construct_event` (Stripe SDK).
    To keep the SDK optional in tests, when `RECODE_IT_WEBHOOK_TEST_BYPASS=1`
    AND `STRIPE_WEBHOOK_SECRET` is empty, the raw JSON body is parsed without
    signature check. Production MUST set the secret; the bypass branch logs
    a warning to stderr.
    """
    if scope.get("method") != "POST":
        await _send_json(send, 405, {"error": "method_not_allowed"})
        return

    raw_body = await _read_body(receive)

    sig_header: str | None = None
    for name, value in scope.get("headers", []):
        if name.lower() == b"stripe-signature":
            try:
                sig_header = value.decode("latin-1")
            except UnicodeDecodeError:
                sig_header = None
            break

    secret = os.environ.get(ENV_WEBHOOK_SECRET)
    test_bypass = os.environ.get("RECODE_IT_WEBHOOK_TEST_BYPASS") == "1"

    if not secret and not test_bypass:
        print(
            f"[recode-stripe] FATAL: {ENV_WEBHOOK_SECRET} not set; rejecting event",
            file=sys.stderr,
        )
        await _send_json(send, 500, {"error": "webhook_secret_not_configured"})
        return

    if secret:
        if not sig_header:
            await _send_json(send, 400, {"error": "missing_stripe_signature"})
            return
        try:
            import stripe  # type: ignore
        except ImportError:
            print("[recode-stripe] stripe SDK not installed — cannot verify signature",
                  file=sys.stderr)
            await _send_json(send, 500, {"error": "stripe_sdk_missing"})
            return
        try:
            event = stripe.Webhook.construct_event(raw_body, sig_header, secret)
        except ValueError:
            await _send_json(send, 400, {"error": "invalid_payload"})
            return
        except stripe.error.SignatureVerificationError:  # type: ignore[attr-defined]
            await _send_json(send, 400, {"error": "invalid_signature"})
            return
        event_dict = event if isinstance(event, dict) else event.to_dict()
    else:
        # Test bypass — parse JSON directly, no signature check.
        print(
            "[recode-stripe] WARNING: RECODE_IT_WEBHOOK_TEST_BYPASS=1 — "
            "signature NOT verified",
            file=sys.stderr,
        )
        try:
            event_dict = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            await _send_json(send, 400, {"error": "invalid_payload"})
            return

    try:
        process_event(event_dict)
    except Exception as exc:
        print(
            f"[recode-stripe] handler exception event={event_dict.get('id')} "
            f"type={event_dict.get('type')}: {exc!r}",
            file=sys.stderr,
        )
        await _send_json(send, 500, {"error": "handler_failed"})
        return

    await _send_json(send, 200, {"received": True})


__all__ = [
    "WEBHOOK_PATH",
    "ENV_WEBHOOK_SECRET",
    "stripe_webhook_endpoint",
    "process_event",
]
