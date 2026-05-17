"""
test_crypto_server.py — server-side primitives (password hashing,
recovery-code hashing, kdf_salt generation, JWT round-trip).

These complement the FRONTEND crypto tests in src/api/__tests__/crypto.test.ts
which cover Argon2id KDF + AES-256-GCM zero-knowledge round-trip and the
R-04 mitigation surface (nonce uniqueness, tamper detection, wrong-key
failure).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
import pytest

from backend import auth_jwt, password


def test_argon2_password_round_trip():
    h = password.hash_password("a long enough passphrase to pass policy")
    assert password.verify_password(h, "a long enough passphrase to pass policy")
    assert not password.verify_password(h, "different password entirely")


def test_password_policy_min_length():
    with pytest.raises(password.WeakPasswordError):
        password.validate_password_strength("short")
    password.validate_password_strength("twelvecharspw")  # exactly 13


def test_recovery_codes_are_unique_and_well_formed():
    codes = password.generate_recovery_codes(10)
    assert len(codes) == 10
    assert len(set(codes)) == 10
    for c in codes:
        assert c.count("-") == 2
        for grp in c.split("-"):
            assert len(grp) == 4
            assert grp.isalnum() and grp.isupper()


def test_recovery_code_hash_verify_tolerates_dashes_and_case():
    codes = password.generate_recovery_codes(1)
    h = password.hash_recovery_code(codes[0])
    assert password.verify_recovery_code(h, codes[0])
    assert password.verify_recovery_code(h, codes[0].replace("-", ""))
    assert password.verify_recovery_code(h, codes[0].lower())
    assert not password.verify_recovery_code(h, "AAAA-BBBB-CCCC")


def test_kdf_salt_is_16_bytes_and_random():
    s1 = password.generate_kdf_salt()
    s2 = password.generate_kdf_salt()
    assert len(s1) == 16
    assert len(s2) == 16
    assert s1 != s2


def test_jwt_round_trip():
    token, exp = auth_jwt.issue_token("user-abc", "x@y.it")
    claims = auth_jwt.decode_token(token)
    assert claims.user_id == "user-abc"
    assert claims.email == "x@y.it"
    assert claims.expires_at > datetime.now(timezone.utc)


def test_jwt_rejects_expired():
    payload = {
        "sub": "u",
        "email": "x@y.it",
        "iat": int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp()),
        "exp": int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp()),
    }
    secret = auth_jwt._get_secret()  # noqa: SLF001
    token = jwt.encode(payload, secret, algorithm="HS256")
    with pytest.raises(jwt.ExpiredSignatureError):
        auth_jwt.decode_token(token)


def test_jwt_rejects_tampered_signature():
    token, _ = auth_jwt.issue_token("u", "x@y.it")
    # Flip a character in the signature.
    parts = token.split(".")
    parts[2] = ("A" if parts[2][0] != "A" else "B") + parts[2][1:]
    bad = ".".join(parts)
    with pytest.raises(jwt.InvalidTokenError):
        auth_jwt.decode_token(bad)
