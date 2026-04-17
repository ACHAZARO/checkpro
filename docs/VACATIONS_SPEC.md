# CheckPro — Sistema de Vacaciones (Fase 2)

**Fecha**: 2026-04-16
**Autor**: Alejandro + Claude
**Estado**: en implementación

## Propósito

Dar al gerente control total sobre las vacaciones de sus empleados de acuerdo a la LFT 2023, con tres escenarios de uso realista: tomarlas ya, posponerlas con saldo a favor del empleado, o compensarlas trabajando con pago doble. Integra cobertura por sucursal, prima vacacional, y prescripción automática.

## 12 Decisiones (fijas)

1. **hire_date obligatorio**. Default = hoy. Si se pone antigua, el sistema asume aniversarios pasados ya tomados (no genera deuda retroactiva).
2. **Tabla de días**: automática por LFT 2023 con override manual en config/tenant y config/branch.
3. **Existing-employee migration logic**: hire_date enero 2024 + hoy es abril 2026 → asume que ya tomó las de enero 2025 y enero 2026. Próximo aniversario = enero 2027. Balance actual = 0.
4. **Aprobación**: sólo gerente (role owner/manager) desde su panel. El empleado no solicita en la app — pide verbalmente y el gerente registra.
5. **Compensación (no tomar)**: paga doble por los días compensados. Tipo de pago hereda del empleado (efectivo/transferencia, no se especifica "efectivo" hardcoded).
6. **Cobertura en vacaciones**: se respetan reglas de cobertura por sucursal. El que está de vacaciones cobra normal; el que cubre cobra su cobertura normal (sin doble pago al que cubre — sólo el que está de vacaciones gana en paralelo).
7. **Prima vacacional**: 25% mínimo (LFT). Advertencia si gerente baja del 25% pero permite. Configurable por empresa y por sucursal.
8. **Días menos que LFT**: permite pero pinta advertencia amarilla visible en UI. Se registra en audit.
9. **Festivo durante vacaciones**: extiende el periodo 1 día automáticamente.
10. **Anticipación para solicitar**: LFT sugiere 30 días pero al final gerente decide (sin bloqueo, sólo advertencia informativa).
11. **Prescripción**: LFT de 1 año. Periodo pospuesto más de 12 meses → status = "expired" y genera audit. Gerente puede ignorar la prescripción (botón "reactivar") si así lo pacta con el empleado.
12. **Aniversario**: alerta visual en dashboard (tarjeta amarilla "X cumple año el día Y, le tocan N días de vacaciones"). Sin notificación push ni email.

## Modelo de datos

### Nueva columna en `employees`

```sql
hire_date DATE NOT NULL DEFAULT CURRENT_DATE
```

### Nueva tabla `vacation_periods`

```sql
CREATE TABLE vacation_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  anniversary_year INT NOT NULL,        -- 1, 2, 3... (año de antigüedad cumplido)
  entitled_days INT NOT NULL,           -- días a los que tiene derecho
  prima_pct NUMERIC(5,2) NOT NULL DEFAULT 25.0,  -- 25% LFT

  tipo TEXT NOT NULL CHECK (tipo IN ('tomadas','pospuestas','compensadas')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','completed','postponed','expired','cancelled')),

  -- Fechas de ejecución
  start_date DATE,            -- primer día de vacaciones (si tipo=tomadas o compensadas)
  end_date DATE,              -- último día (inclusive)
  completed_at TIMESTAMPTZ,   -- cuándo se marcó como completed

  -- Compensación (tipo=compensadas)
  compensated_days INT,       -- días que trabajó en lugar de descansar
  compensated_amount NUMERIC(12,2),  -- total pagado por esos días (doble)
  payment_type TEXT CHECK (payment_type IN ('efectivo','transferencia')),

  -- Meta
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX vac_periods_employee_idx ON vacation_periods(employee_id, status);
CREATE INDEX vac_periods_tenant_idx ON vacation_periods(tenant_id, status);
CREATE INDEX vac_periods_active_idx ON vacation_periods(tenant_id, start_date, end_date)
  WHERE status = 'active';
```

### RPC helper: cálculo de días según LFT

```sql
CREATE OR REPLACE FUNCTION vacation_days_for_year(p_year INT, p_table JSONB)
RETURNS INT LANGUAGE sql STABLE AS $$
  -- lee la tabla JSONB del tenant/branch [{fromYear,toYear,days}, ...]
  -- regresa los días que aplican al año de antigüedad
$$;
```

### RLS

Se aplica el patrón existente de CheckPro:
- SELECT: empleados del mismo tenant + misma sucursal (managers ven solo su sucursal, owners ven todo)
- INSERT/UPDATE: solo profiles con role in (owner, manager)
- SECURITY DEFINER helpers ya existen (`my_tenant_id`, `my_role`, `my_branch_id`)

## Reglas de negocio clave

### Cálculo de próximo aniversario

```js
function nextAnniversary(hireDate, today = new Date()) {
  const hire = new Date(hireDate)
  const yearsWorked = today.getFullYear() - hire.getFullYear() -
    (today < new Date(today.getFullYear(), hire.getMonth(), hire.getDate()) ? 1 : 0)
  const nextYear = yearsWorked + 1
  const anniv = new Date(hire.getFullYear() + nextYear, hire.getMonth(), hire.getDate())
  return { yearsWorked, nextYear, anniv }
}
```

### Balance actual (existing-employee)

Al agregar un empleado con hire_date antigua:
- Calcular `yearsWorked`
- Crear filas `vacation_periods` "históricas" con `status=completed` y `tipo=tomadas` por cada año pasado — SIN start/end date, sólo para historia.
- Balance visible = 0 hasta próximo aniversario.
- Al llegar próximo aniversario, se genera periodo `pending` automáticamente.

### Extensión por festivo

Al crear un periodo con `start_date` y `end_date`:
- Contar días laborales según schedule del empleado (excluir días de descanso).
- Si hay festivo (config.holidays) dentro del rango → extender `end_date` 1 día por cada festivo.
- El schedule sigue marcando esos días como "vacaciones" (no como laboral).

### Nómina — impacto de vacaciones

- **Días tomadas**: pago normal × 1 + prima vacacional (prima_pct/100 × pago normal). Esto se paga en el corte que incluya el periodo.
- **Días compensadas**: pago × 2 (el empleado trabajó, no tomó vacaciones).
- **Días de cobertura**: empleado A (vacaciones) cobra normal; empleado B (cubre) cobra su normal también. Nadie cobra doble por cobertura.

### Prescripción

Job (en app level, no cron — ejecuta al abrir dashboard):
- Si `vacation_period.status = 'postponed'` y `created_at < NOW() - INTERVAL '1 year'` → status = 'expired' + audit.
- Gerente ve alerta "X tiene vacaciones prescritas" en dashboard con botón "reactivar" (vuelve a pending).

## UI

### Dashboard (home)

Sección nueva debajo del widget de cumpleaños:
- **Aniversarios próximos (30 días)**: empleado, fecha, días que le tocarán. Amarillo si <7 días.
- **En vacaciones hoy**: lista de empleados activos + quién los cubre.
- **Pendientes de aprobar**: 0 por ahora (no hay flujo de solicitud del empleado en esta fase).
- **Prescripciones**: periodos pospuestos >1 año con botón reactivar.

### Empleados (detalle)

Sección "Vacaciones" con:
- Balance disponible (días)
- Próximo aniversario (fecha + días que desbloqueará)
- Histórico (tabla con año, tipo, status, días, fechas)
- 3 botones:
  - **Tomar ahora** → form: start_date, end_date (auto-calculado), notas. Extiende por festivos.
  - **Posponer** → queda `tipo=pospuestas, status=postponed`. Aparece en histórico.
  - **Compensar** → form: días a compensar, tipo_pago (hereda empleado), monto (auto-calculado doble). Registra en nómina del corte.

### Checador (`/check`)

Si empleado intenta checar dentro de un periodo `status=active`:
- Modal: "Estás en vacaciones hasta dd/mm. ¿Reincorporación temprana?" + dos botones:
  - "Sí, reincorporarme" → cierra el periodo, marca completed, continúa check normal
  - "Cancelar" → vuelve a la pantalla de PIN

### Asistencia

Días de vacaciones se pintan morado (`#a855f7` o similar) con label "🏖 Vacaciones". Los días de cobertura del compañero se pintan cyan con label "Cobertura".

## Endpoints API

Todos en `/src/app/api/vacations/`:

- `POST /api/vacations/create` — body: `{ employee_id, tipo, start_date?, end_date?, days?, prima_pct?, payment_type?, notes? }`. Valida rol owner/manager. Aplica extensión por festivo. Crea periodo + audit.
- `POST /api/vacations/:id/cancel` — cancela un periodo pending o active. Audit.
- `POST /api/vacations/:id/resume` — reanuda un periodo pospuesto. Requiere start_date/end_date.
- `POST /api/vacations/:id/early-return` — empleado regresa antes de tiempo (llamado desde checador o desde panel).
- `POST /api/vacations/:id/reactivate` — reactiva un periodo expirado (ignorar prescripción).
- `GET /api/vacations/employee/:id` — historial completo del empleado.
- `GET /api/vacations/active` — empleados actualmente en vacaciones (para asistencia/dashboard).
- `GET /api/vacations/upcoming` — aniversarios en los próximos 30 días.

## Lo que NO está en esta fase

- Empleado solicita vacaciones desde una app/portal (solo gerente registra).
- Notificaciones push/email (solo UI visual).
- Export de reporte de vacaciones (se integra al reporte de nómina existente).
- Politica de acumulación de varios años (cada aniversario genera su periodo independiente; el empleado puede tener N periodos pospuestos).

## Entregables por etapa

1. **DB + helpers**: migración SQL, tabla, RPC, índices. lib/vacations.js con cálculos.
2. **Form empleado**: hire_date input obligatorio.
3. **Endpoints API**: 8 rutas anteriores.
4. **UI gerente**: sección vacaciones en detalle de empleado + 3 botones + histórico.
5. **Integraciones**: checador, asistencia visual, nómina.
6. **Dashboard**: aniversarios, activas, prescripciones.
