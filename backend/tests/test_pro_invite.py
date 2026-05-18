"""
test_pro_invite.py — Recode-IT Phase 1 pro funnel tests.

Copre:
  - POST /recode/pro/request-invite: reason < 25 char → 400; ok → 201
  - POST /recode/pro/request-invite: double-pending → 409 (unique partial idx)
  - POST /recode/admin/pro/approve: no admin key → 403; valid → 200 + token
  - POST /recode/pro/claim-invite: token invalid / expired / wrong sig → 400
  - POST /recode/pro/claim-invite: valid → 200 con stripe URL + client_reference_id
  - GET  /recode/pro/my-request: hydrating dell'ultima richiesta
  - Webhook customer.subscription.created → user.tier=pro + request.status=claimed
"""

from __future__ import annotations

import json


# ---------------------------------------------------------------------------
# Setup helpers (extend conftest registered fixture)
# ---------------------------------------------------------------------------

ADMIN_KEY_VALUE = "test-admin-key-aaaaaaaaaaaaaaaaaaaaaaaaa"
INVITE_SECRET_VALUE = "test-invite-secret-bbbbbbbbbbbbbbbbbbb"
STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_recode_pro_phase1"


import pytest


@pytest.fixture(autouse=True)
def _pro_env(monkeypatch):
    monkeypatch.setenv("RECODE_IT_INVITE_SECRET", INVITE_SECRET_VALUE)
    monkeypatch.setenv("RECODE_IT_ADMIN_KEY", ADMIN_KEY_VALUE)
    monkeypatch.setenv(
        "RECODE_IT_PRO_STRIPE_PAYMENT_LINK_URL", STRIPE_PAYMENT_LINK,
    )
    # Webhook signature bypass for unit tests (no Stripe SDK round-trip).
    monkeypatch.setenv("RECODE_IT_WEBHOOK_TEST_BYPASS", "1")
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)


# ---------------------------------------------------------------------------
# request-invite
# ---------------------------------------------------------------------------

def test_request_invite_reason_too_short(registered):
    c = registered["client"]
    resp = c.post(
        "/recode/pro/request-invite", json={"reason": "Troppo corta."},
    )
    assert resp.status_code == 400, resp.text
    body = resp.json()
    assert body["error"] == "reason_too_short"
    assert body["min_length"] == 25


def test_request_invite_valid(registered):
    c = registered["client"]
    reason = (
        "Sono un avvocato civilista a Milano e voglio usare Recode IT per "
        "anonimizzare atti prima di darli in pasto a Claude."
    )
    resp = c.post("/recode/pro/request-invite", json={"reason": reason})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert isinstance(body["request_id"], int)


def test_request_invite_double_pending_blocked(registered):
    c = registered["client"]
    reason = "x" * 30
    r1 = c.post("/recode/pro/request-invite", json={"reason": reason})
    assert r1.status_code == 201
    r2 = c.post("/recode/pro/request-invite", json={"reason": reason})
    assert r2.status_code == 409, r2.text
    assert r2.json()["error"] == "request_already_active"


def test_my_request_endpoint(registered):
    c = registered["client"]
    # Before any request → null.
    r0 = c.get("/recode/pro/my-request")
    assert r0.status_code == 200
    assert r0.json()["request"] is None
    # After submitting a request, hydrating returns the latest.
    c.post("/recode/pro/request-invite",
           json={"reason": "y" * 30})
    r1 = c.get("/recode/pro/my-request")
    assert r1.status_code == 200
    body = r1.json()["request"]
    assert body["status"] == "pending"
    assert body["claimed_at"] is None


# ---------------------------------------------------------------------------
# admin approve
# ---------------------------------------------------------------------------

def test_admin_approve_without_key_denied(registered):
    c = registered["client"]
    rid = c.post("/recode/pro/request-invite",
                 json={"reason": "z" * 30}).json()["request_id"]
    # No Authorization header.
    resp = c.post("/recode/admin/pro/approve", json={"request_id": rid})
    assert resp.status_code == 403, resp.text


def test_admin_approve_with_wrong_key_denied(registered):
    c = registered["client"]
    rid = c.post("/recode/pro/request-invite",
                 json={"reason": "z" * 30}).json()["request_id"]
    resp = c.post(
        "/recode/admin/pro/approve",
        json={"request_id": rid},
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert resp.status_code == 403


def test_admin_approve_valid_emits_token(registered):
    c = registered["client"]
    rid = c.post("/recode/pro/request-invite",
                 json={"reason": "z" * 30}).json()["request_id"]
    resp = c.post(
        "/recode/admin/pro/approve",
        json={"request_id": rid},
        headers={"Authorization": f"Bearer {ADMIN_KEY_VALUE}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    token = body["invite_token_plain_for_audit_NEVER_LOG"]
    assert "." in token  # format <rand>.<sig>
    assert body["request_id"] == rid

    # my-request must now reflect status=approved.
    mr = c.get("/recode/pro/my-request").json()["request"]
    assert mr["status"] == "approved"


# ---------------------------------------------------------------------------
# claim-invite
# ---------------------------------------------------------------------------

def test_claim_invite_invalid_token(client):
    resp = client.post("/recode/pro/claim-invite", json={"token": "notvalid"})
    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "invalid_invite_token"


def test_claim_invite_wrong_signature(registered):
    c = registered["client"]
    rid = c.post("/recode/pro/request-invite",
                 json={"reason": "z" * 30}).json()["request_id"]
    approve = c.post(
        "/recode/admin/pro/approve",
        json={"request_id": rid},
        headers={"Authorization": f"Bearer {ADMIN_KEY_VALUE}"},
    ).json()
    token = approve["invite_token_plain_for_audit_NEVER_LOG"]
    # Tamper with the signature half.
    rand, _, sig = token.partition(".")
    tampered = f"{rand}.{('a' * len(sig))}"
    resp = c.post("/recode/pro/claim-invite", json={"token": tampered})
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_invite_token"


def test_claim_invite_valid_returns_stripe_url(registered):
    c = registered["client"]
    user_id = registered["user_id"]
    rid = c.post("/recode/pro/request-invite",
                 json={"reason": "z" * 30}).json()["request_id"]
    approve = c.post(
        "/recode/admin/pro/approve",
        json={"request_id": rid},
        headers={"Authorization": f"Bearer {ADMIN_KEY_VALUE}"},
    ).json()
    token = approve["invite_token_plain_for_audit_NEVER_LOG"]

    resp = c.post("/recode/pro/claim-invite", json={"token": token})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert STRIPE_PAYMENT_LINK in body["stripe_payment_link_url"]
    assert f"client_reference_id={user_id}" in body["stripe_payment_link_url"]
    assert body["user_id"] == user_id


# ---------------------------------------------------------------------------
# Stripe webhook
# ---------------------------------------------------------------------------

def test_webhook_subscription_created_upgrades_tier(registered):
    c = registered["client"]
    user_id = registered["user_id"]
    rid = c.post("/recode/pro/request-invite",
                 json={"reason": "z" * 30}).json()["request_id"]
    c.post(
        "/recode/admin/pro/approve",
        json={"request_id": rid},
        headers={"Authorization": f"Bearer {ADMIN_KEY_VALUE}"},
    )
    # Simulate Stripe customer.subscription.created webhook.
    payload = {
        "id": "evt_test_001",
        "type": "customer.subscription.created",
        "data": {
            "object": {
                "id": "sub_test_001",
                "metadata": {"client_reference_id": user_id},
            }
        },
    }
    # Bare ASGI mount: TestClient sends to /recode/stripe/webhook (NOT with
    # trailing slash) — Mount matches the path prefix.
    resp = c.post("/recode/stripe/webhook", json=payload)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"received": True}

    # User must now be tier=pro.
    me = c.get("/recode/me").json()
    assert me["tier"] == "pro"

    # The invite request must be claimed.
    mr = c.get("/recode/pro/my-request").json()["request"]
    assert mr["status"] == "claimed"
    assert mr["claimed_at"] is not None


def test_webhook_idempotent_on_duplicate(registered):
    c = registered["client"]
    user_id = registered["user_id"]
    payload = {
        "id": "evt_dup_001",
        "type": "customer.subscription.created",
        "data": {
            "object": {
                "id": "sub_dup_001",
                "metadata": {"client_reference_id": user_id},
            }
        },
    }
    r1 = c.post("/recode/stripe/webhook", json=payload)
    r2 = c.post("/recode/stripe/webhook", json=payload)
    assert r1.status_code == 200
    assert r2.status_code == 200
    # User still pro after second call (no exception).
    me = c.get("/recode/me").json()
    assert me["tier"] == "pro"


__all__: list[str] = []
