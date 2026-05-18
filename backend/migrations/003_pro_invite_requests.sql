-- Recode-IT migration 003: pro invite request funnel (Phase 1, gratis su invito).
--
-- Implementa il "request-then-invite" pattern per l'upgrade al piano pro:
--   1. utente free invia `reason` → row con status='pending'.
--   2. founder approva manualmente → status='approved' + invite_token_hash + scadenza.
--   3. utente clicca link con token → claim → Stripe Payment Link €0/mese subscribe.
--   4. webhook Stripe customer.subscription.created → status='claimed' + tier=pro.
--   Rifiuto / scadenza → status='rejected' / 'expired'; lo user può ri-richiedere.
--
-- UNIQUE constraint pattern scelto (vs `UNIQUE(user_id, status) ON CONFLICT REPLACE`
-- suggerito dal task): un unique INDEX parziale su user_id filtrato agli stati
-- "live" ('pending' + 'approved'). Motivazione:
--   - vincolo proposto da spec userebbe REPLACE, sostituendo la riga al volo
--     e perdendo la storia.
--   - vogliamo invece preservare l'audit trail completo (più richieste storiche
--     per utente OK) ma impedire double-pending o pending-mentre-approved.
--   - una volta che lo stato passa a 'claimed' / 'rejected' / 'expired' il
--     vincolo non si applica più → utente può ri-richiedere.
--
-- `invite_token_hash` = SHA-256 hex del token plain. Il token plain non viene
-- mai memorizzato (esce solo via email all'utente). Verify ricalcola SHA-256
-- e fa lookup costante per riga 'approved'. La firma HMAC del token è gestita
-- in `pro_invite.py` (env RECODE_IT_INVITE_SECRET) e serve a impedire forgery
-- prima ancora del lookup DB.

CREATE TABLE IF NOT EXISTS recode_pro_invite_requests (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                  TEXT NOT NULL REFERENCES recode_users(id) ON DELETE CASCADE,
  reason                   TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','claimed','expired')),
  requested_at             TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at              TEXT,
  invite_token_hash        TEXT,
  invite_token_expires_at  TEXT,
  claimed_at               TEXT,
  rejected_at              TEXT
);

CREATE INDEX IF NOT EXISTS idx_pro_invite_user
  ON recode_pro_invite_requests(user_id);

CREATE INDEX IF NOT EXISTS idx_pro_invite_status
  ON recode_pro_invite_requests(status);

-- Unique partial index: max 1 row "live" (pending OR approved) per user.
-- Stati terminali (claimed/rejected/expired) sono esclusi → si può ri-richiedere.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pro_invite_user_active
  ON recode_pro_invite_requests(user_id)
  WHERE status IN ('pending', 'approved');

-- Idempotency per Stripe webhook events: previene doppia
-- elaborazione di un singolo customer.subscription.created in caso di
-- redelivery. Pattern mirror di MHC-L `stripe_events_processed`.
CREATE TABLE IF NOT EXISTS recode_stripe_events_processed (
  event_id      TEXT PRIMARY KEY,
  event_type    TEXT NOT NULL,
  processed_at  TEXT NOT NULL
);
