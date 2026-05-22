"""
Tests for P1 + P2 rate limiting (security review 2026-05-23).

These tests use the `client_with_rate_limit` fixture, which builds the
app with the slowapi limiter ENABLED. Other test modules disable it via
RECODE_IT_RATE_LIMIT=0 to avoid back-to-back-request flakiness on
unrelated paths.

Note on slowapi storage: the limiter is an in-memory singleton at module
scope. Between tests it accumulates state; we reset it explicitly at the
top of each test that asserts counter exhaustion. Without that reset,
test order would couple the assertions.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _reset_limiter():
    """Wipe the slowapi storage between tests so counters start fresh."""
    from backend.rate_limit import limiter
    limiter.reset()
    yield
    limiter.reset()


def test_login_per_ip_limit_blocks_after_5_attempts(client_with_rate_limit):
    """5 attempts allowed in 15 min per IP; 6th must 429."""
    c = client_with_rate_limit
    # Try logging into a non-existent account 5 times — each returns 401.
    # The 6th should hit the IP limit (5/15min).
    for i in range(5):
        r = c.post("/recode/login",
                   json={"email": f"target{i}@example.it",
                         "password": "Wrong Wrong 99!"})
        assert r.status_code == 401, f"attempt {i+1} expected 401 got {r.status_code}"
    r = c.post("/recode/login",
               json={"email": "target5@example.it",
                     "password": "Wrong Wrong 99!"})
    assert r.status_code == 429
    body = r.json()
    assert body["error"] == "rate_limited"


def test_recovery_initiate_per_ip_limit_blocks_after_3(client_with_rate_limit):
    """3 initiate / hour per IP; 4th must 429."""
    c = client_with_rate_limit
    for i in range(3):
        r = c.post("/recode/recovery/initiate",
                   json={"email": f"target{i}@example.it"})
        assert r.status_code == 200, f"attempt {i+1}"
    r = c.post("/recode/recovery/initiate",
               json={"email": "target4@example.it"})
    assert r.status_code == 429


def test_recovery_verify_per_token_limit_blocks_after_5(client_with_rate_limit):
    """5 verify / 15min per token; 6th must 429. Distinct tokens have
    distinct buckets — so we must hit the SAME token 6 times."""
    c = client_with_rate_limit
    same_token = "fixed-token-for-bucket-keying"
    for i in range(5):
        r = c.post("/recode/recovery/verify",
                   json={"token": same_token,
                         "recovery_code": "WHATEVER",
                         "new_password": "Whatever 99!! pwd"})
        # Either 400 (invalid token) or 200 — never 429 within the first 5.
        assert r.status_code != 429, f"attempt {i+1} prematurely rate-limited"
    r = c.post("/recode/recovery/verify",
               json={"token": same_token,
                     "recovery_code": "WHATEVER",
                     "new_password": "Whatever 99!! pwd"})
    assert r.status_code == 429


def test_distinct_tokens_have_distinct_buckets(client_with_rate_limit):
    """Hitting verify_recovery with 5 different tokens should NOT trigger
    the per-token limit on any of them."""
    c = client_with_rate_limit
    for i in range(5):
        r = c.post("/recode/recovery/verify",
                   json={"token": f"token-{i}",
                         "recovery_code": "WHATEVER",
                         "new_password": "Whatever 99!! pwd"})
        assert r.status_code != 429


def test_rate_limit_response_shape(client_with_rate_limit):
    """429 response must follow the project's error contract."""
    c = client_with_rate_limit
    # Burn the per-IP login bucket.
    for _ in range(5):
        c.post("/recode/login",
               json={"email": "x@y.it", "password": "Wrong Wrong 99!"})
    r = c.post("/recode/login",
               json={"email": "x@y.it", "password": "Wrong Wrong 99!"})
    assert r.status_code == 429
    body = r.json()
    assert body["error"] == "rate_limited"
    assert "message" in body
