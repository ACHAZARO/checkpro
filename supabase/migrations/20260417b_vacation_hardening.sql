-- 2026-04-17 (hardening): CHECKs, trigger branch_id, índice expire, TZ fix, RLS branch

-- 1) CHECK constraints en vacation_periods (drop+add para idempotencia)
DO $$ BEGIN
  ALTER TABLE vacation_periods DROP CONSTRAINT IF EXISTS vp_entitled_days_chk;
  ALTER TABLE vacation_periods DROP CONSTRAINT IF EXISTS vp_compensated_days_chk;
  ALTER TABLE vacation_periods DROP CONSTRAINT IF EXISTS vp_prima_pct_chk;
  ALTER TABLE vacation_periods DROP CONSTRAINT IF EXISTS vp_anniv_year_chk;
END $$;

ALTER TABLE vacation_periods
  ADD CONSTRAINT vp_entitled_days_chk CHECK (entitled_days >= 0 AND entitled_days <= 60),
  ADD CONSTRAINT vp_compensated_days_chk CHECK (compensated_days IS NULL OR (compensated_days >= 0 AND compensated_days <= entitled_days)),
  ADD CONSTRAINT vp_prima_pct_chk CHECK (prima_pct >= 0 AND prima_pct <= 100),
  ADD CONSTRAINT vp_anniv_year_chk CHECK (anniversary_year >= 1 AND anniversary_year <= 99);

-- 2) Trigger que hereda branch_id de employees
CREATE OR REPLACE FUNCTION vacation_periods_set_branch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT branch_id INTO NEW.branch_id FROM employees WHERE id = NEW.employee_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS tr_vp_set_branch ON vacation_periods;
CREATE TRIGGER tr_vp_set_branch
  BEFORE INSERT ON vacation_periods
  FOR EACH ROW EXECUTE FUNCTION vacation_periods_set_branch();

-- 3) Índice para expiración eficiente (postponed pendientes de expirar)
CREATE INDEX IF NOT EXISTS vac_periods_postponed_idx
  ON vacation_periods (tenant_id, anniversary_year)
  WHERE status = 'postponed';

-- 4) Fix expire_old_vacation_periods con TZ America/Mexico_City y cubre 'active'/'pending' también
CREATE OR REPLACE FUNCTION expire_old_vacation_periods(p_tenant_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE vacation_periods vp
  SET status = 'expired', updated_at = NOW()
  FROM employees e
  WHERE vp.employee_id = e.id
    AND vp.tenant_id = p_tenant_id
    AND vp.status IN ('postponed','pending')
    AND e.hire_date IS NOT NULL
    AND (e.hire_date + (vp.anniversary_year || ' years')::interval + INTERVAL '1 year')::date
        < (NOW() AT TIME ZONE 'America/Mexico_City')::date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 5) RLS INSERT/UPDATE: manager solo puede afectar vacaciones de su branch
DROP POLICY IF EXISTS vp_insert ON vacation_periods;
CREATE POLICY vp_insert ON vacation_periods FOR INSERT
  WITH CHECK (
    tenant_id = my_tenant_id()
    AND my_role() IN ('owner','manager','super_admin')
    AND (
      is_tenant_admin()
      OR EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = employee_id
          AND e.tenant_id = my_tenant_id()
          AND (e.branch_id = my_branch_id() OR my_branch_id() IS NULL)
      )
    )
  );

DROP POLICY IF EXISTS vp_update ON vacation_periods;
CREATE POLICY vp_update ON vacation_periods FOR UPDATE
  USING (
    tenant_id = my_tenant_id()
    AND (
      is_tenant_admin()
      OR EXISTS (
        SELECT 1 FROM employees e
        WHERE e.id = employee_id
          AND e.tenant_id = my_tenant_id()
          AND (e.branch_id = my_branch_id() OR my_branch_id() IS NULL)
      )
    )
  )
  WITH CHECK (tenant_id = my_tenant_id());
