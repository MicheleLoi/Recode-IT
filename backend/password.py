"""
password.py — Recode-IT password + recovery-code primitives (Phase 3).

Argon2id for user passwords (resists GPU attacks; recommended over bcrypt
for new deployments in 2026). bcrypt for recovery-code hashes (one-time
codes, low computation cost acceptable; rate-limited at the endpoint
level).

Password policy (applied to NEW passwords only — signup + recovery reset.
NOT retroactive to existing accounts):
  - Minimum 12 characters (R-04 mitigation indirect — reduces weak-password
    surface for the AES key derived client-side from the password material).
  - At least 3 character classes from {lowercase, uppercase, digit, special}
    (security hardening 2026-05-23 P4 — defeats single-class dictionary
    attacks while staying friendly to passphrases, which can satisfy the
    rule by mixing case + a punctuation mark).

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
MIN_PASSWORD_CLASSES = 3
RECOVERY_CODE_GROUPS = 3
RECOVERY_CODE_GROUP_LEN = 4
# Crockford base32-ish: dropped I, L, O, U, 0, 1 to avoid visual confusion.
_RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"


class WeakPasswordError(ValueError):
    """Raised when a user-supplied password violates policy."""


def _count_character_classes(password: str) -> int:
    """Count how many of {lowercase, uppercase, digit, special} appear.

    Special = anything that is not alphanumeric (punctuation, symbols,
    whitespace, non-ASCII letters all roll into 'special' deliberately —
    we don't want to be paternalistic about exotic Unicode).
    """
    classes = 0
    if any(c.islower() and c.isascii() for c in password):
        classes += 1
    if any(c.isupper() and c.isascii() for c in password):
        classes += 1
    if any(c.isdigit() and c.isascii() for c in password):
        classes += 1
    if any(not c.isalnum() for c in password):
        classes += 1
    return classes


def validate_password_strength(password: str) -> None:
    """Raise WeakPasswordError on policy violations.

    Policy (NEW passwords only — signup + recovery reset, NOT retroactive):
      - length >= MIN_PASSWORD_LENGTH (12)
      - at least MIN_PASSWORD_CLASSES (3) classes from
        {lowercase, uppercase, digit, special-non-alphanumeric}
    """
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"password must be at least {MIN_PASSWORD_LENGTH} characters"
        )
    classes = _count_character_classes(password)
    if classes < MIN_PASSWORD_CLASSES:
        raise WeakPasswordError(
            f"password must include at least {MIN_PASSWORD_CLASSES} of: "
            f"lowercase, uppercase, digit, special (got {classes})"
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
    """Linear scan over a user's stored bcrypt hashes; returns the match or None.

    P7 timing surface (security review 2026-05-23): every user has at most
    10 stored recovery codes (see signup.generate_recovery_codes default).
    With N <= 10 and bcrypt rounds=10 (~100ms per verify) the worst-case
    scan is bounded at ~1s — that's the *budget*, not a leak vector,
    because:
      - bcrypt.checkpw itself is constant-time (HMAC + consttime_bytes_eq
        inside argon2-cffi / bcrypt), so per-iteration cost does NOT
        depend on how many leading characters of the hash matched.
      - We iterate ALL stored_hashes (no early return on match) to keep
        wallclock independent of which slot the matching code occupies.
        That removes the residual oracle "user's 1st code matched" vs
        "user's 10th code matched".

    If recovery code count ever grows beyond ~50 per user (it shouldn't —
    UX caps at 10) this should be revisited with a pre-hashed lookup
    keyed on a deterministic derivation of the user input (sha256 of
    normalized code) plus a per-code salt stored alongside; the bcrypt
    hash then verifies only the single candidate.
    """
    match: str | None = None
    for h in stored_hashes:
        if verify_recovery_code(h, code) and match is None:
            match = h
        # NB: no `break` — keep iterating so timing is independent of
        # which slot holds the match (or whether there's a match at all).
    return match


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
    "MIN_PASSWORD_CLASSES",
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
