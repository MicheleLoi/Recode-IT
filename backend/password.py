"""
password.py — Recode-IT password + recovery-code primitives (Phase 3).

Argon2id for user passwords (resists GPU attacks; recommended over bcrypt
for new deployments in 2026). bcrypt for recovery-code hashes (one-time
codes, low computation cost acceptable; rate-limited at the endpoint
level).

Minimum password length: 12 chars (R-04 mitigation indirect — reduces
weak-password surface for the AES key derived client-side from the
password material).

Recovery code format: 3 alphanumeric uppercase groups of 4 chars each,
joined by dashes (e.g. `A7K3-9P2M-X4N8`). Twelve characters of base32-ish
alphabet (no I/O/0/1 → fewer ambiguities) deliver >57 bits of entropy per
code — far above what's exposed by bcrypt rate-limited online attacks.
"""

from __future__ import annotations

import secrets
from typing import Iterable

import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

# Tuned defaults from argon2-cffi documentation for interactive logins.
# These are NOT the same Argon2 parameters as the CLIENT-side KDF (which
# uses memory_cost=64MB, time_cost=3, parallelism=1 — see crypto.ts).
# This server-side hasher protects DB exfiltration; the client-side KDF
# protects the master encryption key.
_PASSWORD_HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=64 * 1024,  # 64 MiB
    parallelism=1,
    hash_len=32,
    salt_len=16,
)

MIN_PASSWORD_LENGTH = 12
RECOVERY_CODE_GROUPS = 3
RECOVERY_CODE_GROUP_LEN = 4
# Crockford base32-ish: dropped I, L, O, U, 0, 1 to avoid visual confusion.
_RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"


class WeakPasswordError(ValueError):
    """Raised when a user-supplied password violates policy."""


def validate_password_strength(password: str) -> None:
    """Raise WeakPasswordError on policy violations."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"password must be at least {MIN_PASSWORD_LENGTH} characters"
        )


def hash_password(password: str) -> str:
    """Hash a password with Argon2id."""
    return _PASSWORD_HASHER.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    """Verify a password against an Argon2id hash."""
    try:
        return _PASSWORD_HASHER.verify(stored_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def generate_recovery_codes(n: int = 10) -> list[str]:
    """
    Generate `n` one-time recovery codes. Each is `groups` × `len`
    characters, separated by '-'. Returns the plaintext list (display once
    to the user; only bcrypt hashes are stored).
    """
    codes: list[str] = []
    for _ in range(n):
        groups = [
            "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(RECOVERY_CODE_GROUP_LEN))
            for _ in range(RECOVERY_CODE_GROUPS)
        ]
        codes.append("-".join(groups))
    return codes


def hash_recovery_code(code: str) -> str:
    """bcrypt-hash a recovery code. Caller MUST normalize input first."""
    return bcrypt.hashpw(_normalize_recovery_code(code).encode("utf-8"),
                         bcrypt.gensalt(rounds=10)).decode("ascii")


def verify_recovery_code(stored_hash: str, code: str) -> bool:
    """Check a recovery code against a bcrypt hash."""
    try:
        return bcrypt.checkpw(
            _normalize_recovery_code(code).encode("utf-8"),
            stored_hash.encode("ascii"),
        )
    except (ValueError, TypeError):
        return False


def find_matching_code(stored_hashes: Iterable[str], code: str) -> str | None:
    """Linear scan over a user's stored bcrypt hashes; returns the match or None."""
    for h in stored_hashes:
        if verify_recovery_code(h, code):
            return h
    return None


def generate_kdf_salt() -> bytes:
    """16 random bytes for client-side Argon2id KDF."""
    return secrets.token_bytes(16)


def generate_email_token() -> str:
    """URL-safe token for email confirmation / password reset (32 bytes → ~43 chars)."""
    return secrets.token_urlsafe(32)


def _normalize_recovery_code(code: str) -> str:
    """Uppercase + strip; tolerate hyphens removed by user."""
    return "".join(ch for ch in code.upper().strip() if ch.isalnum())


__all__ = [
    "MIN_PASSWORD_LENGTH",
    "WeakPasswordError",
    "validate_password_strength",
    "hash_password",
    "verify_password",
    "generate_recovery_codes",
    "hash_recovery_code",
    "verify_recovery_code",
    "find_matching_code",
    "generate_kdf_salt",
    "generate_email_token",
]
