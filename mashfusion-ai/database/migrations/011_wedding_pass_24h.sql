-- NOTE: This file shares the `011_` prefix with `011_screen_config.sql`.
-- The duplicate numbering is INTENTIONAL — it reflects the historical
-- order in which the two migrations were authored. Both files have
-- already been APPLIED in production. Do NOT rename either file:
-- renumbering would break the migration tracker and re-trigger them.
--
-- ═════════════════════════════════════════════════════════════════
-- Wedding Pass 24H — One-time payment per accesso temporaneo
-- ═════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wedding_passes (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id                UUID          REFERENCES live_sessions(id) ON DELETE SET NULL,
  stripe_payment_intent_id  TEXT          UNIQUE,
  amount_cents              INTEGER       NOT NULL,
  currency                  TEXT          NOT NULL DEFAULT 'eur',
  valid_until               TIMESTAMPTZ   NOT NULL,  -- now() + interval '24 hours'
  status                    TEXT          NOT NULL DEFAULT 'active'
                                          CHECK (status IN ('active', 'expired', 'refunded')),
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index per performance
CREATE INDEX IF NOT EXISTS idx_wedding_passes_user_id ON wedding_passes(user_id);
CREATE INDEX IF NOT EXISTS idx_wedding_passes_session_id ON wedding_passes(session_id);
CREATE INDEX IF NOT EXISTS idx_wedding_passes_valid_until ON wedding_passes(valid_until);
CREATE INDEX IF NOT EXISTS idx_wedding_passes_user_valid ON wedding_passes(user_id, valid_until);

-- Helper function: check se l'utente ha accesso wedding attivo
CREATE OR REPLACE FUNCTION has_wedding_access(p_user_id UUID, p_session_id UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  user_plan TEXT;
  has_valid_pass BOOLEAN;
BEGIN
  -- Controlla piano utente
  SELECT plan INTO user_plan FROM users WHERE id = p_user_id;
  IF user_plan = 'wedding' THEN
    RETURN TRUE;
  END IF;

  -- Controlla wedding pass valido
  SELECT EXISTS (
    SELECT 1
    FROM wedding_passes
    WHERE user_id = p_user_id
      AND status = 'active'
      AND valid_until > NOW()
      AND (p_session_id IS NULL OR session_id = p_session_id OR session_id IS NULL)
  ) INTO has_valid_pass;

  RETURN has_valid_pass;
END;
$$ LANGUAGE plpgsql STABLE;

-- Trigger per auto-expire passes scaduti
CREATE OR REPLACE FUNCTION auto_expire_wedding_passes()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wedding_passes
  SET status = 'expired'
  WHERE status = 'active'
    AND valid_until < NOW();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Esegui check ogni 10 minuti (via pg_cron o scheduled task)
-- In alternativa, il check può essere fatto a livello applicativo

COMMENT ON TABLE wedding_passes IS 'Wedding Pass 24H — accesso temporaneo a feature Wedding Edition per €7.99 one-time';
COMMENT ON COLUMN wedding_passes.valid_until IS 'Pass scade 24 ore dopo il pagamento completato';
COMMENT ON FUNCTION has_wedding_access IS 'Ritorna TRUE se utente ha piano wedding oppure wedding pass valido';
