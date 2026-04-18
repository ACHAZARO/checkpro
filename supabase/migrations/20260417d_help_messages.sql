-- 2026-04-17d: help_messages
-- Mensajes enviados desde /dashboard/help (preguntas, sugerencias, bugs).
-- El pipeline semanal (Cowork) lee los bugs, los analiza y genera fix_proposals
-- que el dueno aprueba en /dashboard/bugs.

-- 1) Tabla principal
CREATE TABLE IF NOT EXISTS help_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- quien lo reporta (puede ser admin con cuenta o "anonimo" desde un form)
  reporter_profile_id UUID REFERENCES profiles(id),
  reporter_name TEXT,
  reporter_email TEXT,

  -- clasificacion que hace el usuario al mandar el form
  kind TEXT NOT NULL CHECK (kind IN ('pregunta','sugerencia','bug')),

  title TEXT NOT NULL,
  description TEXT NOT NULL,
  page_context TEXT,   -- ruta/url donde estaba el usuario
  user_agent TEXT,     -- para reproducir bugs de mobile vs desktop

  -- flujo: open -> analyzing -> awaiting_approval -> approved/rejected -> fixed/wont_fix
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','analyzing','awaiting_approval','approved','rejected','fixed','wont_fix')),
  severity TEXT CHECK (severity IN ('bajo','medio','alto','critico')),

  -- resultado del analisis del pipeline (Claude en Cowork)
  analysis_summary TEXT,     -- resumen en lenguaje de NEGOCIO (lo que ve el dueno)
  analysis_technical TEXT,   -- archivos/logica a tocar (detalle tecnico)
  analysis_impact TEXT,      -- que cambia para el usuario final si se aplica
  fix_commit_sha TEXT,       -- commit aplicado
  fix_pr_url TEXT,           -- PR en GitHub (si se crea uno)

  analyzed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES profiles(id),
  fixed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS help_messages_tenant_status_idx
  ON help_messages (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS help_messages_kind_idx
  ON help_messages (tenant_id, kind, created_at DESC);

-- 2) Trigger updated_at
CREATE OR REPLACE FUNCTION help_messages_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_help_messages_updated_at ON help_messages;
CREATE TRIGGER trg_help_messages_updated_at
  BEFORE UPDATE ON help_messages
  FOR EACH ROW EXECUTE FUNCTION help_messages_set_updated_at();

-- 3) RLS (sigue el patron de vacation_periods)
ALTER TABLE help_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier miembro del tenant puede ver los mensajes de su tenant
DROP POLICY IF EXISTS hm_select ON help_messages;
CREATE POLICY hm_select ON help_messages
  FOR SELECT TO authenticated
  USING (tenant_id = my_tenant_id());

-- INSERT: cualquier miembro del tenant puede crear mensajes (preguntas/sugerencias/bugs)
DROP POLICY IF EXISTS hm_insert ON help_messages;
CREATE POLICY hm_insert ON help_messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = my_tenant_id());

-- UPDATE: solo admins (owner/manager) pueden cambiar status, aprobar o rechazar.
-- El pipeline corre con service_role -> bypassea RLS para analysis_* y status.
DROP POLICY IF EXISTS hm_update ON help_messages;
CREATE POLICY hm_update ON help_messages
  FOR UPDATE TO authenticated
  USING (
    tenant_id = my_tenant_id()
    AND my_role() IN ('owner','manager','super_admin')
  );

-- DELETE: solo admin puede borrar (por si quieren limpiar ruido)
DROP POLICY IF EXISTS hm_delete ON help_messages;
CREATE POLICY hm_delete ON help_messages
  FOR DELETE TO authenticated
  USING (
    tenant_id = my_tenant_id()
    AND is_tenant_admin()
  );

-- 4) Comentarios (documentacion inline)
COMMENT ON TABLE help_messages IS
  'Mensajes del centro de ayuda: preguntas (FAQ que no encontraron), sugerencias y bugs. Pipeline semanal los procesa.';
COMMENT ON COLUMN help_messages.analysis_summary IS
  'Resumen del fix en lenguaje de NEGOCIO (lo que el dueno lee para aprobar). Sin jerga tecnica.';
COMMENT ON COLUMN help_messages.analysis_impact IS
  'Que cambia para el usuario final si se aplica el fix. Usado por /dashboard/bugs.';
