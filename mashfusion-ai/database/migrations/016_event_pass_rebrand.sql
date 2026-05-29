-- ═════════════════════════════════════════════════════════════════
-- Event Pass 24H — Rebrand di "Wedding Pass 24H"
-- Rinomina tabella, indici e funzioni per riflettere il nuovo
-- prodotto unificato (Party Mode + Wedding Edition).
-- Idempotente: safe to re-run anche se wedding_passes non è mai
-- stata creata (es. ambienti freschi senza migration 011).
-- ═════════════════════════════════════════════════════════════════

-- 1) Tabella: wedding_passes → event_passes (no-op se già rinominata)
ALTER TABLE IF EXISTS wedding_passes RENAME TO event_passes;

-- 2) Indici (rename) — no-op se i nomi vecchi non esistono
ALTER INDEX IF EXISTS idx_wedding_passes_user_id      RENAME TO idx_event_passes_user_id;
ALTER INDEX IF EXISTS idx_wedding_passes_session_id   RENAME TO idx_event_passes_session_id;
ALTER INDEX IF EXISTS idx_wedding_passes_valid_until  RENAME TO idx_event_passes_valid_until;
ALTER INDEX IF EXISTS idx_wedding_passes_user_valid   RENAME TO idx_event_passes_user_valid;

-- 3) Indici (create) + commenti su tabella/colonna
--    Eseguiti solo se la tabella event_passes esiste davvero,
--    in modo che la migration non fallisca su DB freschi che non
--    hanno mai avuto wedding_passes / event_passes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.tables
    WHERE  table_schema = 'public'
      AND  table_name   = 'event_passes'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_event_passes_user_id      ON event_passes(user_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_event_passes_session_id   ON event_passes(session_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_event_passes_valid_until  ON event_passes(valid_until)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_event_passes_user_valid   ON event_passes(user_id, valid_until)';

    EXECUTE $cmt$COMMENT ON TABLE event_passes IS 'Event Pass 24H — accesso temporaneo Party Mode + Wedding Edition per €7.99 one-time'$cmt$;
    EXECUTE $cmt$COMMENT ON COLUMN event_passes.valid_until IS 'Pass scade 24 ore dopo il pagamento completato'$cmt$;
  END IF;
END
$$;

-- 4) Funzione: has_event_access + auto_expire_event_passes
--    CREATE OR REPLACE FUNCTION è idempotente; i riferimenti a
--    event_passes nel corpo sono risolti a runtime. Le creiamo solo
--    se la tabella esiste, per coerenza con il resto della migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.tables
    WHERE  table_schema = 'public'
      AND  table_name   = 'event_passes'
  ) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION has_event_access(p_user_id UUID, p_session_id UUID DEFAULT NULL)
      RETURNS BOOLEAN AS $body$
      DECLARE
        user_plan TEXT;
        has_valid_pass BOOLEAN;
      BEGIN
        SELECT plan INTO user_plan FROM users WHERE id = p_user_id;
        IF user_plan = 'wedding' THEN
          RETURN TRUE;
        END IF;

        SELECT EXISTS (
          SELECT 1
          FROM event_passes
          WHERE user_id = p_user_id
            AND status = 'active'
            AND valid_until > NOW()
            AND (p_session_id IS NULL OR session_id = p_session_id OR session_id IS NULL)
        ) INTO has_valid_pass;

        RETURN has_valid_pass;
      END;
      $body$ LANGUAGE plpgsql STABLE;
    $fn$;

    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION auto_expire_event_passes()
      RETURNS TRIGGER AS $body$
      BEGIN
        UPDATE event_passes
        SET status = 'expired'
        WHERE status = 'active'
          AND valid_until < NOW();
        RETURN NULL;
      END;
      $body$ LANGUAGE plpgsql;
    $fn$;

    EXECUTE $cmt$COMMENT ON FUNCTION has_event_access IS 'Ritorna TRUE se utente ha piano wedding/advance oppure un event pass 24h valido'$cmt$;
  END IF;
END
$$;

-- 5) Drop delle vecchie funzioni (rinominate, non più usate dal codice)
DROP FUNCTION IF EXISTS has_wedding_access(UUID, UUID);
DROP FUNCTION IF EXISTS auto_expire_wedding_passes();
