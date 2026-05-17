"""
db.py — Recode-IT SQLite storage (Phase 3).

Manages five additive tables for user accounts, recovery codes, encrypted
mapping blobs, false-positive preferences, and email tokens. Separate from
MHC-L's `~/.mhc-l-keystore.db`; default path is `~/.recode-it.db` to keep
deployment domains independent (a future merge into a single SQLite file
would be a deliberate refactor, not the default).

Mirrors the pragma + connect discipline of MHC-L `mcp_server/db.py`:
  - WAL journal mode (concurrent readers)
  - FK enforcement ON
  - autocommit isolation level (callers manage tx explicitly)

The schema is materialized from `migrations/001_initial.sql`. `init_schema()`
is idempotent: it executes the file (CREATE TABLE IF NOT EXISTS …) at
startup.

Stdlib only.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

DB_PATH_ENV = "RECODE_IT_DB_PATH"
DEFAULT_DB_PATH = Path.home() / ".recode-it.db"

_MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


def resolve_db_path() -> Path:
    """Return the SQLite DB path: env override or DEFAULT_DB_PATH."""
    env_path = os.environ.get(DB_PATH_ENV)
    if env_path:
        return Path(env_path).expanduser()
    return DEFAULT_DB_PATH


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    """Open a SQLite connection with Recode-IT pragmas applied."""
    path = db_path or resolve_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


def init_schema(db_path: Path | None = None) -> Path:
    """Run all migrations in numeric order. Idempotent."""
    path = db_path or resolve_db_path()
    conn = connect(path)
    try:
        for migration in sorted(_MIGRATIONS_DIR.glob("*.sql")):
            sql = migration.read_text(encoding="utf-8")
            conn.executescript(sql)
    finally:
        conn.close()
    return path


@contextmanager
def connection(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    """Context manager wrapper for short-lived connections."""
    conn = connect(db_path)
    try:
        yield conn
    finally:
        conn.close()


__all__ = [
    "DB_PATH_ENV",
    "DEFAULT_DB_PATH",
    "resolve_db_path",
    "connect",
    "init_schema",
    "connection",
]
