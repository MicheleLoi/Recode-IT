"""Tests for POST /recode/login + /recode/me + /recode/logout."""

from __future__ import annotations

from backend.auth_jwt import JWT_COOKIE_NAME


def test_login_success_sets_cookie(client, signup_payload):
    client.post("/recode/signup", json=signup_payload)
    resp = client.post("/recode/login", json=signup_payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == signup_payload["email"]
    assert "kdf_salt" in body
    # Cookie must be set.
    assert JWT_COOKIE_NAME in client.cookies


def test_login_wrong_password(client, signup_payload):
    client.post("/recode/signup", json=signup_payload)
    resp = client.post("/recode/login",
                       json={**signup_payload, "password": "Wrong Wrong Wrong 9"})
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_credentials"


def test_login_unknown_email(client):
    # Note: login doesn't validate password strength (verify_password just fails);
    # any string works for the unknown-email path.
    resp = client.post("/recode/login",
                       json={"email": "nobody@nowhere.it", "password": "Doesnt Matter 99"})
    assert resp.status_code == 401
    # Generic error — no oracle.
    assert resp.json()["error"] == "invalid_credentials"


def test_me_requires_auth(client):
    resp = client.get("/recode/me")
    assert resp.status_code == 401


def test_me_returns_user_after_login(registered):
    c = registered["client"]
    resp = c.get("/recode/me")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user_id"] == registered["user_id"]
    assert body["email"] == registered["email"]


def test_logout_clears_cookie(registered):
    c = registered["client"]
    resp = c.post("/recode/logout")
    assert resp.status_code == 200
    # Subsequent /recode/me should now 401.
    resp2 = c.get("/recode/me")
    assert resp2.status_code == 401
