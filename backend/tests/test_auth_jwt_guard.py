"""
Tests for P3 JWT secret fail-fast guard (security hardening 2026-05-23).

Production must NEVER fall back to a static default. The escape hatches are
narrow and explicit (pytest auto-set env, or operator opt-in).
"""

from __future__ import annotations

import importlib
import sys

import pytest


def _reimport_auth_jwt():
    """Force a fresh import so the secret resolver runs against current env."""
    for mod in list(sys.modules):
        if mod.startswith("backend.auth_jwt"):
            del sys.modules[mod]
    return importlib.import_module("backend.auth_jwt")


def test_get_secret_uses_env_var_when_present(monkeypatch):
    monkeypatch.setenv("RECODE_IT_JWT_SECRET", "a" * 64)
    monkeypatch.delenv("RECODE_IT_ALLOW_INSECURE_JWT", raising=False)
    auth_jwt = _reimport_auth_jwt()
    assert auth_jwt._get_secret() == "a" * 64


def test_get_secret_raises_when_env_missing_and_not_test_mode(monkeypatch):
    """Production scenario: no env var, no pytest marker, no opt-in flag."""
    monkeypatch.delenv("RECODE_IT_JWT_SECRET", raising=False)
    monkeypatch.delenv("RECODE_IT_ALLOW_INSECURE_JWT", raising=False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    auth_jwt = _reimport_auth_jwt()
    with pytest.raises(RuntimeError, match="RECODE_IT_JWT_SECRET"):
        auth_jwt._get_secret()


def test_get_secret_allows_insecure_opt_in(monkeypatch):
    monkeypatch.delenv("RECODE_IT_JWT_SECRET", raising=False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setenv("RECODE_IT_ALLOW_INSECURE_JWT", "1")
    auth_jwt = _reimport_auth_jwt()
    # Should not raise; returns the static default.
    secret = auth_jwt._get_secret()
    assert "test-only-do-not-use-in-prod" in secret


def test_get_secret_allows_pytest_marker(monkeypatch):
    """pytest sets PYTEST_CURRENT_TEST automatically; we set it explicitly here
    in case the fixture isolation cleared it."""
    monkeypatch.delenv("RECODE_IT_JWT_SECRET", raising=False)
    monkeypatch.delenv("RECODE_IT_ALLOW_INSECURE_JWT", raising=False)
    monkeypatch.setenv("PYTEST_CURRENT_TEST", "test_marker_active")
    auth_jwt = _reimport_auth_jwt()
    secret = auth_jwt._get_secret()
    assert "test-only-do-not-use-in-prod" in secret


def test_issue_token_raises_in_prod_without_secret(monkeypatch):
    """Sanity: the guard surfaces at issue_token call-time too."""
    monkeypatch.delenv("RECODE_IT_JWT_SECRET", raising=False)
    monkeypatch.delenv("RECODE_IT_ALLOW_INSECURE_JWT", raising=False)
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    auth_jwt = _reimport_auth_jwt()
    with pytest.raises(RuntimeError, match="RECODE_IT_JWT_SECRET"):
        auth_jwt.issue_token("u1", "x@y.it")
