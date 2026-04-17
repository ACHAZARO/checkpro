-- 2026-04-17c: week_cuts.vacation_period_ids[] para evitar pago doble de
-- vacaciones si un periodo se reabre o se renueva entre cortes. De momento
-- solo registramos; el dedupe en el calculo se hara en una fase posterior.

ALTER TABLE week_cuts
  ADD COLUMN IF NOT EXISTS vacation_period_ids uuid[] DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS week_cuts_vac_period_ids_idx
  ON week_cuts USING GIN (vacation_period_ids);

COMMENT ON COLUMN week_cuts.vacation_period_ids IS
  'IDs de vacation_periods cuyos compensated_days o dias tomados se pagaron en este corte. Evita doble pago si el periodo se renueva/reabre entre cortes.';
