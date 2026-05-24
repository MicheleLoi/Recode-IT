-- 004_add_reverse_substitution_permission.sql
-- Adds reverse-substitution permission tracking to recode_users.
-- Three columns, all nullable (existing rows = no permission by default).
--
-- reverse_substitution_permitted_at: timestamp ISO 8601 when permission granted
--                                    (NULL = denied).
-- reverse_substitution_source: 'paid' | 'mhc_bearer' | 'pro_tier' | NULL.
--   - 'paid'      → Stripe one-time €20 checkout.session.completed
--   - 'mhc_bearer'→ user pasted valid MHC Bearer key, validated against
--                   /root/.mhc-l-keystore.db (cross-DB lookup, read-only)
--   - 'pro_tier'  → implied for users with tier='pro' (computed at read time,
--                   typically NOT persisted in this column; included in CHECK
--                   constraint for forward compatibility if we ever persist).
-- linked_mhc_user_email: when source='mhc_bearer', the email associated with
--                        the MHC Bearer (audit trail + future bundle features).
--
-- Naming history: pre-2026-05-24 the columns were named `view_key_*`. The
-- pricing pivot (founder ratifica SID-20260524-051552) moved the paywall
-- from "view the mapping" (now free) to "reverse-substitution"
-- (paste AI document with pseudonyms → output with real names). Backend
-- columns renamed accordingly. Pre-pivot DBs are migrated by the Python
-- pre-migration hook `_pre_migration_rename_view_key_columns` in db.py
-- (runs BEFORE this .sql to rename existing view_key_* columns; this
-- file's ADD COLUMN then hits "duplicate column name" and is swallowed
-- by the migration loop's idempotency guard).
--
-- Idempotent via SQLite ALTER TABLE ADD COLUMN (will raise 'duplicate column
-- name' on re-apply; init_schema() catches and continues per migration pattern).

ALTER TABLE recode_users ADD COLUMN reverse_substitution_permitted_at TEXT NULL;
ALTER TABLE recode_users ADD COLUMN reverse_substitution_source TEXT NULL CHECK (reverse_substitution_source IN ('paid', 'mhc_bearer', 'pro_tier') OR reverse_substitution_source IS NULL);
ALTER TABLE recode_users ADD COLUMN linked_mhc_user_email TEXT NULL;
