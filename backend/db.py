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


def _pre_migration_rename_view_key_columns(conn: sqlite3.Connection) -> None:
    """Pre-migration hook: rename `view_key_*` columns on `recode_users` if present.

    Pricing pivot 2026-05-24 (founder ratifica SID-20260524-051552) renamed
    the paid feature from "view-key" to "reverse-substitution". Migration
    004 was rewritten in place to create the new column names; the renamed
    file ships alongside 005 (a Python-pre-step here, not a .sql file)
    that handles DBs already migrated under the OLD names.

    This hook must run BEFORE the .sql migration loop so that:
      - Pre-pivot DB (founder local dev applied 004-old): columns get
        renamed → 004-new's `ADD COLUMN reverse_substitution_*` then hits
        "duplicate column name" and is swallowed → consistent final state.
      - Fresh DB (no recode_users yet, or no `view_key_*` columns):
        the column-list check returns empty → no-op → 004-new creates the
        columns directly.
      - Already-migrated post-pivot DB: column-list check finds the new
        names already in place (no `view_key_*` present) → no-op.

    Idempotent. Stdlib only.
    """
    # Check if table exists at all (true even on a fully fresh DB after 001
    # has run via the migration loop — but this hook runs BEFORE 001, so
    # on a truly fresh DB the table doesn't exist yet and we bail early).
    try:
        cols = [
            row["name"]
            for row in conn.execute(
                "SELECT name FROM pragma_table_info('recode_users')"
            ).fetchall()
        ]
    except sqlite3.OperationalError:
        return  # table doesn't exist yet; nothing to rename
    if not cols:
        return  # table doesn't exist; nothing to rename

    rename_map = {
        "view_key_permitted_at": "reverse_substitution_permitted_at",
        "view_key_source": "reverse_substitution_source",
    }
    for old, new in rename_map.items():
        if old in cols and new not in cols:
            conn.execute(
                f"ALTER TABLE recode_users RENAME COLUMN {old} TO {new}"
            )


def init_schema(db_path: Path | None = None) -> Path:
    """Run all migrations in numeric order. Idempotent.

    Two error classes are swallowed to keep migrations idempotent across
    DBs in different historical states:

      - `duplicate column name` / `already exists` — `ADD COLUMN` /
        `CREATE TABLE IF NOT EXISTS` re-applied on a DB where the migration
        already ran.

    Each migration runs in its own try/except. Any other error class
    propagates.

    Pre-migration hooks (Python, not .sql) run BEFORE the .sql loop to
    handle schema transformations that pure-SQL migrations cannot express
    idempotently (e.g. RENAME COLUMN). See
    `_pre_migration_rename_view_key_columns` for the 2026-05-24 pricing
    pivot rename.
    """
    path = db_path or resolve_db_path()
    conn = connect(path)
    try:
        # Pre-migration hooks (run before SQL migrations).
        _pre_migration_rename_view_key_columns(conn)

        for migration in sorted(_MIGRATIONS_DIR.glob("*.sql")):
            sql = migration.read_text(encoding="utf-8")
            try:
                conn.executescript(sql)
            except sqlite3.OperationalError as exc:
                msg = str(exc).lower()
                if "duplicate column" in msg or "already exists" in msg:
                    # Migration already applied on a previous boot.
                    continue
                raise
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
