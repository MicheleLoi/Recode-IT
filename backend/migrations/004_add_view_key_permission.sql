-- 004_add_view_key_permission.sql
-- Adds view-key permission tracking to recode_users.
-- Three columns, all nullable (existing rows = no permission by default).
--
-- view_key_permitted_at: timestamp ISO 8601 when permission granted (NULL = denied).
-- view_key_source: 'paid' | 'mhc_bearer' | 'pro_tier' | NULL.
--   - 'paid'      → Stripe one-time €20 checkout.session.completed
--   - 'mhc_bearer'→ user pasted valid MHC Bearer key, validated against
--                   /root/.mhc-l-keystore.db (cross-DB lookup, read-only)
--   - 'pro_tier'  → implied for users with tier='pro' (computed at read time,
--                   typically NOT persisted in this column; included in CHECK
--                   constraint for forward compatibility if we ever persist).
-- linked_mhc_user_email: when source='mhc_bearer', the email associated with
--                        the MHC Bearer (audit trail + future bundle features).
--
-- Idempotent via SQLite ALTER TABLE ADD COLUMN (will raise 'duplicate column
-- name' on re-apply; init_schema() catches and continues per migration pattern).

ALTER TABLE recode_users ADD COLUMN view_key_permitted_at TEXT NULL;
ALTER TABLE recode_users ADD COLUMN view_key_source TEXT NULL CHECK (view_key_source IN ('paid', 'mhc_bearer', 'pro_tier') OR view_key_source IS NULL);
ALTER TABLE recode_users ADD COLUMN linked_mhc_user_email TEXT NULL;
