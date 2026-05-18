"""Tests for POST/DELETE /recode/me/marketing-consent.

These endpoints sit behind JWT (user-initiated post-signup opt-in / opt-out
from an account dashboard). The verify-email path is the OTHER way to enable
the flag; this is the "I changed my mind" path.
"""

from __future__ import annotations

import os
import sqlite3


def test_marketing_consent_requires_auth(client):
    resp = client.post("/recode/me/marketing-consent")
    assert resp.status_code == 401
    assert resp.json()["error"] == "auth_required"


def test_marketing_consent_post_then_delete_round_trip(registered):
    client = registered["client"]
    user_id = registered["user_id"]
    db_path = os.environ["RECODE_IT_DB_PATH"]

    # Initially 0 (signup payload did not include marketing flag).
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT marketing_consent FROM recode_users WHERE id = ?", (user_id,)
    ).fetchone()
    conn.close()
    assert row["marketing_consent"] == 0

    # POST → subscribe.
    resp = client.post("/recode/me/marketing-consent")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["marketing_consent"] is True
    assert body["verified_at"]

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT marketing_consent, marketing_consent_verified_at "
        "FROM recode_users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    assert row["marketing_consent"] == 1
    assert row["marketing_consent_verified_at"]

    # DELETE → unsubscribe (paper-trail verified_at preserved).
    resp = client.delete("/recode/me/marketing-consent")
    assert resp.status_code == 200
    assert resp.json()["marketing_consent"] is False

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT marketing_consent, marketing_consent_verified_at "
        "FROM recode_users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    assert row["marketing_consent"] == 0
    assert row["marketing_consent_verified_at"]  # historical record preserved


def test_me_response_includes_tier_and_name(registered):
    client = registered["client"]
    resp = client.get("/recode/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tier"] == "free"
    assert body["name"] == "Studio Legale Test"
    assert body["marketing_consent"] is False
