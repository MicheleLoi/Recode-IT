-- Recode-IT Phase 3 initial schema.
--
-- Five additive tables — separate from MHC-L api_keys / applications. The
-- shape is the contract from DESIGN.md §"DB schema" with two tweaks:
--   - integer surrogate keys where the user task spec asked for them
--     (recode_recovery_codes, encrypted_mappings, user_false_positive_preferences,
--     recode_email_tokens), keeping a stable text user UUID elsewhere.
--   - recode_email_tokens covers both 'email_verification' AND 'password_reset'
--     (per task spec — recovery flow uses an email token + a recovery code).
--
-- All FKs use ON DELETE CASCADE so DELETE /recode/account/ wipes everything.

CREATE TABLE IF NOT EXISTS recode_users (
  id                      TEXT PRIMARY KEY,
  email                   TEXT NOT NULL UNIQUE,
  password_hash           TEXT NOT NULL,
  kdf_salt                TEXT NOT NULL,
  email_verified          INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  status                  TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at              TEXT NOT NULL,
  last_login_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_recode_users_email ON recode_users(email);

CREATE TABLE IF NOT EXISTS recode_recovery_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user
  ON recode_recovery_codes(user_id);

CREATE TABLE IF NOT EXISTS encrypted_mappings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  mapping_id        TEXT NOT NULL,
  blob              BLOB NOT NULL,
  label             TEXT,
  doc_type          TEXT,
  size_bytes        INTEGER NOT NULL,
  created_at        TEXT NOT NULL,
  last_accessed_at  TEXT,
  UNIQUE (user_id, mapping_id)
);

CREATE INDEX IF NOT EXISTS idx_encrypted_mappings_user
  ON encrypted_mappings(user_id);
CREATE INDEX IF NOT EXISTS idx_encrypted_mappings_user_created
  ON encrypted_mappings(user_id, created_at);

CREATE TABLE IF NOT EXISTS user_false_positive_preferences (
  id                              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                         TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  term                            TEXT NOT NULL,
  originally_detected_category    TEXT NOT NULL,
  marked_at                       TEXT NOT NULL,
  UNIQUE (user_id, term, originally_detected_category)
);

CREATE INDEX IF NOT EXISTS idx_fp_user
  ON user_false_positive_preferences(user_id);

CREATE TABLE IF NOT EXISTS recode_email_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL
              CHECK (purpose IN ('email_verification', 'password_reset')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user
  ON recode_email_tokens(user_id);
