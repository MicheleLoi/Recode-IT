-- Recode-IT migration 002: pricing tier + display name + marketing consent.
--
-- Adds the columns needed by the "zero-euro named" tier (capabilities_index §9):
--   - `tier` distinguishes the persistence backend dispatched at runtime:
--       'free' → IndexedDB local plaintext mapping
--       'pro'  → server AES-256-GCM cifrato (existing path)
--   - `name` is the display name collected at signup (required, 1..256 char).
--   - `marketing_consent` (+ `marketing_consent_verified_at`) implement the
--     double opt-in for the newsletter: the checkbox at signup arms a flag on
--     the email-verification token; clicking the verification link sets the
--     consent to 1 and stamps the verified-at timestamp.
--
-- All ALTER TABLE here is purely additive (SQLite reversible via DROP COLUMN
-- from v3.35+). Idempotency on a fresh DB: 001_initial.sql plus this file via
-- `init_schema()`. On an existing DB the SQLite `ALTER TABLE ... ADD COLUMN`
-- raises if the column already exists — we tolerate the duplicate via the
-- explicit error handling in db.py (see init_schema docstring).

ALTER TABLE recode_users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'pro'));

ALTER TABLE recode_users ADD COLUMN name TEXT NOT NULL DEFAULT '';

ALTER TABLE recode_users ADD COLUMN marketing_consent INTEGER NOT NULL DEFAULT 0
  CHECK (marketing_consent IN (0, 1));

ALTER TABLE recode_users ADD COLUMN marketing_consent_verified_at TEXT NULL;

-- Extend the token purpose set to support the "with marketing consent" variant.
-- Old tokens emitted before this migration keep their existing purpose value;
-- the verify-email endpoint dispatches on the purpose column.
--
-- SQLite does not allow ALTER TABLE ... DROP/REPLACE CHECK constraint cleanly,
-- so we rebuild recode_email_tokens with the wider purpose set. The table is
-- short-lived (24h tokens), so the rebuild costs almost nothing.
CREATE TABLE IF NOT EXISTS recode_email_tokens_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL
              CHECK (purpose IN (
                'email_verification',
                'email_verification_with_marketing',
                'password_reset'
              )),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

INSERT INTO recode_email_tokens_v2 (
  id, token_hash, user_id, purpose, expires_at, used_at, created_at
)
SELECT id, token_hash, user_id, purpose, expires_at, used_at, created_at
FROM recode_email_tokens;

DROP TABLE recode_email_tokens;

ALTER TABLE recode_email_tokens_v2 RENAME TO recode_email_tokens;

CREATE INDEX IF NOT EXISTS idx_email_tokens_user
  ON recode_email_tokens(user_id);
