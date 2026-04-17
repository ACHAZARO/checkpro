-- 2026-04-17: Fix prescripcion de vacaciones (LFT)
-- Motivo: la funcion expire_old_vacation_periods usaba created_at, lo cual es
-- incorrecto. Segun LFT el plazo de 1 ano para prescripcion corre a partir de
-- que el empleado pudo tomar las vacaciones, es decir desde el ANIVERSARIO
-- (hire_date + anniversary_year). Un periodo creado hace 13 meses para el
-- aniversario de este mes NO debe expirar; un periodo recien creado para el
-- aniversario del ano pasado SI debe expirar.
--
-- Ademas, como defensa en profundidad contra la race condition TOCTOU en
-- /api/vacations/create (check+insert no atomico), agregamos un UNIQUE INDEX
-- parcial sobre (employee_id, anniversary_year) para periodos vivos.
--
-- NOTA: esta migracion solo modifica la funcion y agrega el indice. No toca
-- datos existentes. Si ya existen duplicados en la tabla, el CREATE INDEX
-- fallara; habria que limpiarlos manualmente antes.

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
    AND vp.status = 'postponed'
    AND e.hire_date IS NOT NULL
    AND (e.hire_date + (vp.anniversary_year || ' years')::interval + INTERVAL '1 year') < NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Defensa en profundidad contra race condition TOCTOU en /api/vacations/create
CREATE UNIQUE INDEX IF NOT EXISTS ux_vacation_periods_emp_anniv_alive
  ON vacation_periods (employee_id, anniversary_year)
  WHERE status NOT IN ('cancelled', 'expired');
