"""
test_reverse_substitution.py — covers /recode/reverse-substitution/* endpoints.

Pattern: temp MHC keystore (sqlite) at tmp_path, populated with test rows,
MHC_KEYSTORE_PATH env monkeypatched to point there. JWT auth via shared
`registered` fixture from conftest.py (signup + login).

Process gap colmato: pre-fix l'intero file `reverse_substitution.py` aveva
zero test coverage. Founder ha incontrato empirically (2026-05-26) un 401
deterministico `auth_required` causato da due bug strutturali combinati:
  - Defect A: handlers leggevano `request.state.user` (mai impostato) invece
    di `request.state.user_id` (convention codebase)
  - Defect B: route `/recode/reverse-substitution` mancava in
    `PROTECTED_PREFIXES_DEFAULT` → middleware skippava, JWT mai validato
Vedi commit `fix(reverse-substitution): resolve 401 auth_required ...`.
"""

from __future__ import annotations

import hashlib
import sqlite3

import pytest


def _hash(plain: str) -> str:
    """Match reverse_substitution._hash_bearer convention (SHA-256 hex UTF-8)."""
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


# Test bearers (deterministic, in temp keystore)
BEARER_ACTIVE = "mhc_live_test_active_xxxxxxxxxxxxxxxxxxxxxxxx"
BEARER_REVOKED = "mhc_live_test_revoked_yyyyyyyyyyyyyyyyyyyyyyy"
BEARER_NOT_IN_DB = "mhc_live_nonexistent_zzzzzzzzzzzzzzzzzzzzzzz"


@pytest.fixture
def mhc_keystore(tmp_path, monkeypatch):
    """Create a temp MHC keystore with seed rows + point env var to it.

    Schema mirrors MHC-L `mcp_server/db.py` minimal subset that
    reverse_substitution.py queries (key_hash PK + user_email + tier + status).
    """
    path = tmp_path / "mhc-keystore.db"
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(
            """
            CREATE TABLE api_keys (
                key_hash TEXT PRIMARY KEY,
                user_email TEXT NOT NULL,
                tier TEXT NOT NULL,
                status TEXT NOT NULL
                  CHECK (status IN ('active','revoked','expired','past_due'))
            )
            """
        )
        conn.execute(
            "INSERT INTO api_keys (key_hash, user_email, tier, status) "
            "VALUES (?, ?, ?, ?)",
            (_hash(BEARER_ACTIVE), "active@example.com", "phase1", "active"),
        )
        conn.execute(
            "INSERT INTO api_keys (key_hash, user_email, tier, status) "
            "VALUES (?, ?, ?, ?)",
            (_hash(BEARER_REVOKED), "revoked@example.com", "phase1", "revoked"),
        )
        conn.commit()
    finally:
        conn.close()

    monkeypatch.setenv("MHC_KEYSTORE_PATH", str(path))
    return path


# ---------------------------------------------------------------------------
# auth boundary — the 3 endpoints all require JWT
# (regression coverage for Defects A+B: pre-fix returned 401 auth_required
# even for authenticated users; we verify both authed AND unauthed paths)
# ---------------------------------------------------------------------------


def test_permission_requires_auth(client):
    r = client.get("/recode/reverse-substitution/permission")
    assert r.status_code == 401
    assert r.json()["error"] == "auth_required"


def test_claim_mhc_bearer_requires_auth(client):
    r = client.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={"bearer": BEARER_ACTIVE},
    )
    assert r.status_code == 401
    assert r.json()["error"] == "auth_required"


def test_claim_checkout_requires_auth(client):
    r = client.post("/recode/reverse-substitution/claim-checkout")
    assert r.status_code == 401
    assert r.json()["error"] == "auth_required"


# ---------------------------------------------------------------------------
# claim-mhc-bearer — body validation
# ---------------------------------------------------------------------------


def test_claim_mhc_bearer_format_invalid(registered):
    c = registered["client"]
    r = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={"bearer": "not_mhc_live_prefix"},
    )
    assert r.status_code == 400
    assert r.json()["error"] == "bearer_format_invalid"


def test_claim_mhc_bearer_required(registered):
    c = registered["client"]
    r = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={},
    )
    assert r.status_code == 400
    assert r.json()["error"] == "bearer_required"


def test_claim_mhc_bearer_invalid_json(registered):
    c = registered["client"]
    r = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        content=b"not-json{",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_json"


# ---------------------------------------------------------------------------
# claim-mhc-bearer — cross-DB keystore lookup (happy + sad)
# ---------------------------------------------------------------------------


def test_claim_mhc_bearer_not_in_keystore(registered, mhc_keystore):
    """Valid format but hash not in keystore → 401 bearer_invalid."""
    c = registered["client"]
    r = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={"bearer": BEARER_NOT_IN_DB},
    )
    assert r.status_code == 401
    assert r.json()["error"] == "bearer_invalid"


def test_claim_mhc_bearer_inactive_status(registered, mhc_keystore):
    """Hash in keystore but status != active → 401 bearer_inactive."""
    c = registered["client"]
    r = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={"bearer": BEARER_REVOKED},
    )
    assert r.status_code == 401
    assert r.json()["error"] == "bearer_inactive"


def test_claim_mhc_bearer_happy_path(registered, mhc_keystore):
    """Valid bearer + active keystore row → 200 + permission persisted."""
    c = registered["client"]
    r = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={"bearer": BEARER_ACTIVE},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["granted"] is True
    assert body["source"] == "mhc_bearer"

    # GET permission now returns granted=True
    p = c.get("/recode/reverse-substitution/permission")
    assert p.status_code == 200
    assert p.json()["granted"] is True
    assert p.json()["source"] == "mhc_bearer"


def test_claim_mhc_bearer_keystore_unavailable(registered, monkeypatch, tmp_path):
    """MHC_KEYSTORE_PATH points to non-existent file → 500 keystore_unavailable."""
    monkeypatch.setenv("MHC_KEYSTORE_PATH", str(tmp_path / "does-not-exist.db"))
    c = registered["client"]
    r = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={"bearer": BEARER_ACTIVE},
    )
    assert r.status_code == 500
    assert r.json()["error"] == "keystore_unavailable"


def test_claim_mhc_bearer_handles_whitespace(registered, mhc_keystore):
    """Trim ASCII whitespace before hash lookup."""
    c = registered["client"]
    r = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={"bearer": f"  {BEARER_ACTIVE}  \n"},
    )
    assert r.status_code == 200
    assert r.json()["granted"] is True


# ---------------------------------------------------------------------------
# GET permission — state transitions
# ---------------------------------------------------------------------------


def test_permission_no_grant_yet(registered):
    """Fresh user has not claimed anything → granted=False."""
    c = registered["client"]
    r = c.get("/recode/reverse-substitution/permission")
    assert r.status_code == 200
    body = r.json()
    assert body["granted"] is False
    assert body["source"] is None


# ---------------------------------------------------------------------------
# claim-checkout — Stripe Payment Link URL
# ---------------------------------------------------------------------------


def test_claim_checkout_returns_url(registered, monkeypatch):
    monkeypatch.setenv(
        "RECODE_IT_REVERSE_SUBSTITUTION_STRIPE_PAYMENT_LINK_URL",
        "https://buy.stripe.com/test_link_xyz",
    )
    c = registered["client"]
    r = c.post("/recode/reverse-substitution/claim-checkout")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["already_granted"] is False
    assert body["checkout_url"].startswith("https://buy.stripe.com/test_link_xyz")
    assert "client_reference_id=" in body["checkout_url"]


def test_claim_checkout_already_granted_after_bearer_claim(
    registered, mhc_keystore, monkeypatch
):
    """After bearer claim succeeds, checkout returns already_granted=True."""
    monkeypatch.setenv(
        "RECODE_IT_REVERSE_SUBSTITUTION_STRIPE_PAYMENT_LINK_URL",
        "https://buy.stripe.com/test_link_xyz",
    )
    c = registered["client"]
    bearer_resp = c.post(
        "/recode/reverse-substitution/claim-mhc-bearer",
        json={"bearer": BEARER_ACTIVE},
    )
    assert bearer_resp.status_code == 200

    r = c.post("/recode/reverse-substitution/claim-checkout")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["already_granted"] is True
    assert body["checkout_url"] is None


def test_claim_checkout_stripe_url_not_configured(registered, monkeypatch):
    monkeypatch.delenv(
        "RECODE_IT_REVERSE_SUBSTITUTION_STRIPE_PAYMENT_LINK_URL",
        raising=False,
    )
    c = registered["client"]
    r = c.post("/recode/reverse-substitution/claim-checkout")
    assert r.status_code == 500
    assert r.json()["error"] == "reverse_substitution_stripe_url_not_configured"
