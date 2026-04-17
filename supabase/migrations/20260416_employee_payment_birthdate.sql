-- 2026-04-16: Añade payment_type y birth_date a employees
-- payment_type: efectivo | transferencia (para recibos firmados)
-- birth_date: opcional, se usa para felicitar en /check y avisar al gerente

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'efectivo'
    CHECK (payment_type IN ('efectivo', 'transferencia')),
  ADD COLUMN IF NOT EXISTS birth_date date NULL;

COMMENT ON COLUMN employees.payment_type IS 'Método de pago preferido: efectivo o transferencia. Aparece en el recibo firmado.';
COMMENT ON COLUMN employees.birth_date IS 'Opcional. Se usa para felicitar al empleado en /check y avisar al gerente un día antes.';
