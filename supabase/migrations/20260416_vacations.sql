-- 2026-04-16: Sistema de vacaciones (Fase 2)
-- Decisiones: ver docs/VACATIONS_SPEC.md

-- 1) Columna hire_date en employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS hire_date DATE NOT NULL DEFAULT CURRENT_DATE;

COMMENT ON COLUMN employees.hire_date IS 'Fecha de ingreso. Default hoy. Si se pone antigua, el sistema asume aniversarios pasados ya tomados (no genera deuda retroactiva).';

-- 2) Tabla vacation_periods
CREATE TABLE IF NOT EXISTS vacation_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  anniversary_year INT NOT NULL,
  entitled_days INT NOT NULL,
  prima_pct NUMERIC(5,2) NOT NULL DEFAULT 25.0,

  tipo TEXT NOT NULL CHECK (tipo IN ('tomadas','pospuestas','compensadas')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','completed','postponed','expired','cancelled')),

  start_date DATE,
  end_date DATE,
  completed_at TIMESTAMPTZ,

  compensated_days INT,
  compensated_amount NUMERIC(12,2),
  payment_type TEXT CHECK (payment_type IN ('efectivo','transferencia')),

  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE vacation_periods IS 'Periodos de vacaciones por aniversario de cada empleado. Ver docs/VACATIONS_SPEC.md';

CREATE INDEX IF NOT EXISTS vac_periods_employee_idx ON vacation_periods(employee_id, status);
CREATE INDEX IF NOT EXISTS vac_periods_tenant_idx ON vacation_periods(tenant_id, status);
CREATE INDEX IF NOT EXISTS vac_periods_active_idx ON vacation_periods(tenant_id, start_date, end_date)
  WHERE status = 'active';

-- 3) Trigger updated_at
CREATE OR REPLACE FUNCTION vacation_periods_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_vacation_periods_updated ON vacation_periods;
CREATE TRIGGER tr_vacation_periods_updated
  BEFORE UPDATE ON vacation_periods
  FOR EACH ROW EXECUTE FUNCTION vacation_periods_set_updated_at();

-- 4) RLS
ALTER TABLE vacation_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vp_select ON vacation_periods;
CREATE POLICY vp_select ON vacation_periods
  FOR SELECT TO authenticated
  USING (
    tenant_id = my_tenant_id()
    AND (
      is_tenant_admin()
      OR branch_id IS NULL
      OR branch_id = my_branch_id()
    )
  );

DROP POLICY IF EXISTS vp_insert ON vacation_periods;
CREATE POLICY vp_insert ON vacation_periods
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = my_tenant_id()
    AND my_role() IN ('owner','manager','super_admin')
  );

DROP POLICY IF EXISTS vp_update ON vacation_periods;
CREATE POLICY vp_update ON vacation_periods
  FOR UPDATE TO authenticated
  USING (
    tenant_id = my_tenant_id()
    AND my_role() IN ('owner','manager','super_admin')
  );

DROP POLICY IF EXISTS vp_delete ON vacation_periods;
CREATE POLICY vp_delete ON vacation_periods
  FOR DELETE TO authenticated
  USING (
    tenant_id = my_tenant_id()
    AND is_tenant_admin()
  );

-- 5) Helper: dias segun tabla LFT
CREATE OR REPLACE FUNCTION vacation_days_for_year(p_year INT, p_table JSONB)
RETURNS INT LANGUAGE plpgsql STABLE AS $$
DECLARE
  row_ JSONB;
BEGIN
  IF p_table IS NULL OR jsonb_typeof(p_table) != 'array' THEN
    -- LFT 2023 default
    RETURN CASE
      WHEN p_year = 1 THEN 12
      WHEN p_year = 2 THEN 14
      WHEN p_year = 3 THEN 16
      WHEN p_year = 4 THEN 18
      WHEN p_year = 5 THEN 20
      WHEN p_year BETWEEN 6 AND 10 THEN 22
      WHEN p_year BETWEEN 11 AND 15 THEN 24
      WHEN p_year BETWEEN 16 AND 20 THEN 26
      WHEN p_year BETWEEN 21 AND 25 THEN 28
      WHEN p_year BETWEEN 26 AND 30 THEN 30
      ELSE 32
    END;
  END IF;

  FOR row_ IN SELECT * FROM jsonb_array_elements(p_table) LOOP
    IF p_year >= (row_->>'fromYear')::INT AND p_year <= (row_->>'toYear')::INT THEN
      RETURN (row_->>'days')::INT;
    END IF;
  END LOOP;

  RETURN 12;
END;
$$;

GRANT EXECUTE ON FUNCTION vacation_days_for_year(INT, JSONB) TO anon, authenticated, service_role;

-- 6) Helper: expiracion automatica (se corre al abrir dashboard)
CREATE OR REPLACE FUNCTION expire_old_vacation_periods(p_tenant_id UUID)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE vacation_periods
  SET status = 'expired', updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND status = 'postponed'
    AND created_at < NOW() - INTERVAL '1 year';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION expire_old_vacation_periods(UUID) TO authenticated, service_role;
