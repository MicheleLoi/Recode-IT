"""Tests for GET /recode/verify-email/{token}.

The endpoint is browser-driven (the user clicks a link in their mail client),
so it returns a 302 redirect on success rather than JSON. We verify:

  1. A fresh `email_verification` token marks the user verified.
  2. A fresh `email_verification_with_marketing` token marks BOTH
     email_verified AND marketing_consent.
  3. An expired token is rejected with 410.
  4. An already-used token is rejected with 410.
  5. A token whose hash isn't in the table is rejected with 404.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from datetime import datetime, timedelta, timezone


def _read_email_token_hash(db_path: str, user_id: str) -> tuple[str, str]:
    """Return (token_hash, purpose) for the user's most-recent token."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        """
        SELECT token_hash, purpose FROM recode_email_tokens
        WHERE user_id = ? ORDER BY id DESC LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    conn.close()
    return row["token_hash"], row["purpose"]


def _intercept_signup_token(client, payload):
    """Sign up and reach into the DB to grab the URL token from its hash.

    `signup_endpoint` doesn't return the raw token (it's mailed). Tests
    monkey-patch `mailer.send_verification_email` to capture it.
    """
    captured: dict[str, str] = {}

    def fake_send(email, token):
        captured["email"] = email
        captured["token"] = token
        return {"id": "fake"}

    # Patch the symbol used by signup.py (imported as bare name).
    import backend.signup as signup_mod
    original = signup_mod.send_verification_email
    signup_mod.send_verification_email = fake_send
    try:
        resp = client.post("/recode/signup", json=payload)
    finally:
        signup_mod.send_verification_email = original
    assert resp.status_code == 201, resp.text
    return resp.json()["user_id"], captured["token"]


def test_verify_email_marks_user_verified(client, signup_payload):
    user_id, token = _intercept_signup_token(client, signup_payload)
    # follow_redirects=False so we can assert on the 302 + Location.
    resp = client.get(f"/recode/verify-email/{token}", follow_redirects=False)
    assert resp.status_code == 302
    assert "verified=1" in resp.headers["location"]

    db_path = os.environ["RECODE_IT_DB_PATH"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT email_verified, marketing_consent FROM recode_users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    assert row["email_verified"] == 1
    # No marketing flag was requested at signup.
    assert row["marketing_consent"] == 0


def test_verify_email_with_marketing_flag_sets_consent(client, signup_payload):
    payload = dict(signup_payload, marketing_consent_requested=True)
    user_id, token = _intercept_signup_token(client, payload)
    resp = client.get(f"/recode/verify-email/{token}", follow_redirects=False)
    assert resp.status_code == 302

    db_path = os.environ["RECODE_IT_DB_PATH"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        """
        SELECT email_verified, marketing_consent, marketing_consent_verified_at
        FROM recode_users WHERE id = ?
        """,
        (user_id,),
    ).fetchone()
    conn.close()
    assert row["email_verified"] == 1
    assert row["marketing_consent"] == 1
    assert row["marketing_consent_verified_at"]  # populated timestamp


def test_verify_email_rejects_unknown_token(client):
    resp = client.get(
        "/recode/verify-email/totally-bogus-token-xxxxxxx",
        follow_redirects=False,
    )
    assert resp.status_code == 404
    assert resp.json()["error"] == "invalid_token"


def test_verify_email_rejects_expired_token(client, signup_payload):
    user_id, token = _intercept_signup_token(client, signup_payload)
    # Force the token to be expired.
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    db_path = os.environ["RECODE_IT_DB_PATH"]
    conn = sqlite3.connect(db_path)
    past = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    conn.execute(
        "UPDATE recode_email_tokens SET expires_at = ? WHERE token_hash = ?",
        (past, token_hash),
    )
    conn.commit()
    conn.close()

    resp = client.get(f"/recode/verify-email/{token}", follow_redirects=False)
    assert resp.status_code == 410
    assert resp.json()["error"] == "token_expired"


def test_verify_email_rejects_already_used_token(client, signup_payload):
    user_id, token = _intercept_signup_token(client, signup_payload)
    # First click → 302.
    first = client.get(f"/recode/verify-email/{token}", follow_redirects=False)
    assert first.status_code == 302
    # Second click → 410.
    second = client.get(f"/recode/verify-email/{token}", follow_redirects=False)
    assert second.status_code == 410
    assert second.json()["error"] == "token_already_used"
