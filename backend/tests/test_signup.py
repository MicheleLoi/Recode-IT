"""Tests for POST /recode/signup."""

from __future__ import annotations


def test_signup_success(client, signup_payload):
    resp = client.post("/recode/signup", json=signup_payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["email"] == signup_payload["email"]
    assert isinstance(body["user_id"], str) and len(body["user_id"]) >= 8
    # kdf_salt is 16 bytes -> 32 hex chars.
    assert len(body["kdf_salt"]) == 32
    assert int(body["kdf_salt"], 16) >= 0  # parses as hex
    assert len(body["recovery_codes"]) == 10
    # Each code: 3 groups of 4 chars joined by '-' → length 14.
    for c in body["recovery_codes"]:
        assert len(c) == 14
        assert c.count("-") == 2
    assert "warning" in body


def test_signup_duplicate_email(client, signup_payload):
    first = client.post("/recode/signup", json=signup_payload)
    assert first.status_code == 201
    again = client.post("/recode/signup", json=signup_payload)
    assert again.status_code == 409
    assert again.json()["error"] == "email_already_registered"


def test_signup_password_too_short(client):
    resp = client.post(
        "/recode/signup",
        json={"email": "x@y.it", "password": "shorty", "name": "Tester"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "weak_password"
    assert body["min_length"] == 12
    assert body["min_classes"] == 3


def test_signup_password_single_class_rejected(client):
    """Post-P4: 12+ chars but only one character class must be rejected."""
    resp = client.post(
        "/recode/signup",
        json={"email": "x@y.it", "password": "alllowercaseword",
              "name": "Tester"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "weak_password"
    assert body["min_classes"] == 3


def test_signup_invalid_email(client):
    resp = client.post(
        "/recode/signup",
        json={
            "email": "notanemail",
            "password": "Long Enough 99 password!",
            "name": "Tester",
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_email"


def test_signup_name_required(client):
    resp = client.post(
        "/recode/signup",
        json={
            "email": "x@y.it",
            "password": "correct horse battery staple",
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "name_required"


def test_signup_name_whitespace_only_rejected(client):
    resp = client.post(
        "/recode/signup",
        json={
            "email": "x@y.it",
            "password": "correct horse battery staple",
            "name": "   ",
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "name_required"


def test_signup_name_too_long(client):
    resp = client.post(
        "/recode/signup",
        json={
            "email": "x@y.it",
            "password": "correct horse battery staple",
            "name": "X" * 257,
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "name_too_long"


def test_signup_persists_tier_free_and_name(client, signup_payload):
    """Tier hardcoded to 'free' at signup; name stored verbatim post-strip."""
    import sqlite3
    import os
    resp = client.post("/recode/signup", json=signup_payload)
    assert resp.status_code == 201
    user_id = resp.json()["user_id"]
    db_path = os.environ["RECODE_IT_DB_PATH"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT tier, name, marketing_consent FROM recode_users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    assert row["tier"] == "free"
    assert row["name"] == signup_payload["name"]
    # Marketing consent always starts at 0 — double opt-in only flips it
    # after verify-email when the user originally ticked the box.
    assert row["marketing_consent"] == 0


def test_signup_marketing_flag_generates_with_marketing_token(client, signup_payload):
    """`marketing_consent_requested=true` → token purpose carries the flag."""
    import sqlite3
    import os
    payload = dict(signup_payload, marketing_consent_requested=True)
    resp = client.post("/recode/signup", json=payload)
    assert resp.status_code == 201
    user_id = resp.json()["user_id"]
    db_path = os.environ["RECODE_IT_DB_PATH"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT purpose FROM recode_email_tokens WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    assert row["purpose"] == "email_verification_with_marketing"


def test_signup_no_marketing_flag_generates_plain_token(client, signup_payload):
    """No checkbox → plain `email_verification` token purpose."""
    import sqlite3
    import os
    resp = client.post("/recode/signup", json=signup_payload)
    assert resp.status_code == 201
    user_id = resp.json()["user_id"]
    db_path = os.environ["RECODE_IT_DB_PATH"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT purpose FROM recode_email_tokens WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    assert row["purpose"] == "email_verification"


def test_signup_recovery_codes_are_distinct(client, signup_payload):
    resp = client.post("/recode/signup", json=signup_payload)
    body = resp.json()
    codes = body["recovery_codes"]
    assert len(set(codes)) == 10, "recovery codes must be unique"
