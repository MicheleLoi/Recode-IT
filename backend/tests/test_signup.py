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
        json={"email": "x@y.it", "password": "shorty"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "weak_password"
    assert body["min_length"] == 12


def test_signup_invalid_email(client):
    resp = client.post(
        "/recode/signup",
        json={"email": "notanemail", "password": "long enough password!"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_email"


def test_signup_recovery_codes_are_distinct(client, signup_payload):
    resp = client.post("/recode/signup", json=signup_payload)
    body = resp.json()
    codes = body["recovery_codes"]
    assert len(set(codes)) == 10, "recovery codes must be unique"
