"""
conftest.py — shared fixtures for backend pytest suite.

Every test runs against a fresh SQLite DB (tmp_path scope per test) with a
stable JWT secret. Cookies are emitted with Secure=False so the in-process
TestClient (which speaks plain HTTP) accepts them on subsequent requests.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient


# Make `backend` importable when pytest is invoked from inside the
# backend/ directory.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))


@pytest.fixture(autouse=True)
def _isolated_env(tmp_path, monkeypatch):
    """Each test gets a fresh DB path + deterministic JWT secret + HTTP cookies."""
    db_path = tmp_path / "recode.db"
    monkeypatch.setenv("RECODE_IT_DB_PATH", str(db_path))
    monkeypatch.setenv(
        "RECODE_IT_JWT_SECRET",
        "test-secret-32-bytes-of-entropy-aaaaaaaa",
    )
    monkeypatch.setenv("RECODE_IT_COOKIE_SECURE", "0")
    monkeypatch.setenv("RECODE_IT_ALLOWED_ORIGIN", "http://testserver")
    # Force a clean import so build_app() picks up the fresh DB path env.
    for mod in list(sys.modules):
        if mod.startswith("backend"):
            del sys.modules[mod]
    yield


@pytest.fixture
def client() -> TestClient:
    server = importlib.import_module("backend.server")
    app = server.build_app(cookie_secure=False)
    return TestClient(app, base_url="http://testserver")


@pytest.fixture
def signup_payload():
    return {
        "email": "avvocato@studio.it",
        "password": "correct horse battery staple",
        "name": "Studio Legale Test",
    }


@pytest.fixture
def registered(client, signup_payload):
    """Sign up + log in a user; return (client, jwt_cookie_value, response_body)."""
    resp = client.post("/recode/signup", json=signup_payload)
    assert resp.status_code == 201, resp.text
    signup_body = resp.json()

    login_resp = client.post("/recode/login", json=signup_payload)
    assert login_resp.status_code == 200, login_resp.text
    # TestClient keeps cookies on the same client instance.
    return {
        "client": client,
        "user_id": signup_body["user_id"],
        "email": signup_body["email"],
        "kdf_salt": signup_body["kdf_salt"],
        "recovery_codes": signup_body["recovery_codes"],
        "login_body": login_resp.json(),
    }
