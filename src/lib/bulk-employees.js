// src/lib/bulk-employees.js
// Helpers compartidos (cliente + server) para carga masiva de empleados.
// - parseSheetData / normalizeHeader / buildRow  → toman output crudo de SheetJS y devuelven filas normalizadas
// - validateRows                                 → corre validaciones de forma/contenido + duplicados dentro del archivo
// - buildSchedulePayload                         → arma el JSONB schedule con el mismo shape que usa la UI manual
// - TEMPLATE_COLUMNS / TEMPLATE_LABELS / TEMPLATE_HELP → metadata única para header, plantilla y preview
import { DAYS } from '@/lib/utils'

// Orden canónico de columnas. Cualquier variación de mayúsculas, acentos, espacios o
// guiones bajos se mapea a uno de estos IDs vía normalizeHeader().
export const TEMPLATE_COLUMNS = [
  'codigo',
  'nombre',
  'departamento',
  'puesto',
  'pin',
  'salario_mensual',
  'puede_administrar',
  'tipo_pago',
  'fecha_ingreso',
  'fecha_nacimiento',
  'horario_mixto',      // feat/mixed-schedule: marca al empleado como mixto
  'horas_diarias',      // feat/mixed-schedule: duracion diaria cuando es mixto
  'lun_inicio', 'lun_fin',
  'mar_inicio', 'mar_fin',
  'mie_inicio', 'mie_fin',
  'jue_inicio', 'jue_fin',
  'vie_inicio', 'vie_fin',
  'sab_inicio', 'sab_fin',
  'dom_inicio', 'dom_fin',
]

export const TEMPLATE_LABELS = {
  codigo: 'codigo',
  nombre: 'nombre',
  departamento: 'departamento',
  puesto: 'puesto',
  pin: 'pin',
  salario_mensual: 'salario_mensual',
  puede_administrar: 'puede_administrar',
  tipo_pago: 'tipo_pago',
  fecha_ingreso: 'fecha_ingreso',
  fecha_nacimiento: 'fecha_nacimiento',
  horario_mixto: 'horario_mixto',
  horas_diarias: 'horas_diarias',
  lun_inicio: 'lun_inicio', lun_fin: 'lun_fin',
  mar_inicio: 'mar_inicio', mar_fin: 'mar_fin',
  mie_inicio: 'mie_inicio', mie_fin: 'mie_fin',
  jue_inicio: 'jue_inicio', jue_fin: 'jue_fin',
  vie_inicio: 'vie_inicio', vie_fin: 'vie_fin',
  sab_inicio: 'sab_inicio', sab_fin: 'sab_fin',
  dom_inicio: 'dom_inicio', dom_fin: 'dom_fin',
}

export const TEMPLATE_HELP = [
  ['codigo', 'Opcional. Ej. EMP001. Si lo dejas vacío, el sistema lo genera en orden.'],
  ['nombre', 'Requerido. Nombre completo del empleado.'],
  ['departamento', 'Opcional. Ej. Cocina, Caja, Operaciones.'],
  ['puesto', 'Opcional. Etiqueta de rol visible en nómina. Default: Empleado.'],
  ['pin', 'Requerido. Exactamente 4 dígitos numéricos. Único por empresa.'],
  ['salario_mensual', 'Opcional. Número sin símbolos (ej. 15000). Default: 0.'],
  ['puede_administrar', 'Opcional. sí/no (o true/false, 1/0). Default: no.'],
  ['tipo_pago', 'Opcional. efectivo o transferencia. Default: efectivo.'],
  ['fecha_ingreso', 'Requerido. Formato YYYY-MM-DD (ej. 2026-04-21). No puede ser futura.'],
  ['fecha_nacimiento', 'Opcional. Formato YYYY-MM-DD. No puede ser futura.'],
  ['horario_mixto', 'Opcional. sí/no. Marca empleados con horario que cambia semana a semana (el gerente los agenda en el Planificador). Requiere activar "Horario mixto" en Configuración.'],
  ['horas_diarias', 'Requerido si horario_mixto = sí. Número de horas que trabaja por día (ej. 8). El gerente luego asigna a qué hora entra cada día.'],
  ['lun_inicio / lun_fin', 'Hora de entrada y salida del lunes en formato HH:MM (24h). Si ambas están vacías = descanso. Se ignora si horario_mixto = sí.'],
  ['mar..dom', 'Mismo formato que lunes para cada día. Al menos 1 día debe tener horario (si no es mixto).'],
]

// Ejemplo de fila usada en la hoja Plantilla para que el usuario vea cómo se llena.
export const TEMPLATE_EXAMPLE_ROW = {
  codigo: '',
  nombre: 'María López',
  departamento: 'Cocina',
  puesto: 'Cocinera',
  pin: '4321',
  salario_mensual: 15000,
  puede_administrar: 'no',
  tipo_pago: 'efectivo',
  fecha_ingreso: '2026-01-15',
  fecha_nacimiento: '1995-08-30',
  horario_mixto: 'no',
  horas_diarias: '',
  lun_inicio: '09:00', lun_fin: '18:00',
  mar_inicio: '09:00', mar_fin: '18:00',
  mie_inicio: '09:00', mie_fin: '18:00',
  jue_inicio: '09:00', jue_fin: '18:00',
  vie_inicio: '09:00', vie_fin: '18:00',
  sab_inicio: '', sab_fin: '',
  dom_inicio: '', dom_fin: '',
}

// Quita acentos + lowercase + trim + colapsa espacios/guiones en _
// "Fecha de Ingreso" → "fecha_de_ingreso" → maps via HEADER_ALIASES
export function normalizeHeader(raw) {
  if (raw == null) return ''
  const s = String(raw)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-./]+/g, '_')
  return HEADER_ALIASES[s] || s
}

// Aliases amigables para que el usuario pueda renombrar columnas de su archivo
// (o traducir desde un Excel en inglés) sin tener que pegarse a los IDs exactos.
const HEADER_ALIASES = {
  cod: 'codigo', codigo_empleado: 'codigo', id: 'codigo',
  nombre_completo: 'nombre', empleado: 'nombre',
  depto: 'departamento', area: 'departamento',
  rol: 'puesto', cargo: 'puesto', role_label: 'puesto',
  salario: 'salario_mensual', sueldo: 'salario_mensual', sueldo_mensual: 'salario_mensual',
  gerente: 'puede_administrar', admin: 'puede_administrar', can_manage: 'puede_administrar',
  pago: 'tipo_pago', payment_type: 'tipo_pago', forma_pago: 'tipo_pago',
  ingreso: 'fecha_ingreso', fecha_alta: 'fecha_ingreso', hire_date: 'fecha_ingreso', fecha_de_ingreso: 'fecha_ingreso',
  nacimiento: 'fecha_nacimiento', cumpleanos: 'fecha_nacimiento', birth_date: 'fecha_nacimiento', fecha_de_nacimiento: 'fecha_nacimiento',
  mixto: 'horario_mixto', es_mixto: 'horario_mixto', is_mixed: 'horario_mixto', horario_rotativo: 'horario_mixto',
  horas_por_dia: 'horas_diarias', daily_hours: 'horas_diarias', jornada_diaria: 'horas_diarias',
  lunes_inicio: 'lun_inicio', lunes_fin: 'lun_fin',
  martes_inicio: 'mar_inicio', martes_fin: 'mar_fin',
  miercoles_inicio: 'mie_inicio', miercoles_fin: 'mie_fin',
  jueves_inicio: 'jue_inicio', jueves_fin: 'jue_fin',
  viernes_inicio: 'vie_inicio', viernes_fin: 'vie_fin',
  sabado_inicio: 'sab_inicio', sabado_fin: 'sab_fin',
  domingo_inicio: 'dom_inicio', domingo_fin: 'dom_fin',
}

// Toma el array 2D de SheetJS (header_row → los demás = filas) y devuelve una lista
// de objetos { <columna>: <valor_raw> } usando normalizeHeader para resolver alias.
// aoa = array-of-arrays típico de XLSX.utils.sheet_to_json con { header: 1 }.
export function parseSheetData(aoa) {
  if (!Array.isArray(aoa) || aoa.length < 1) return { rows: [], headers: [] }
  const headerRow = aoa[0] || []
  const headers = headerRow.map(normalizeHeader)
  const rows = []
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] || []
    // Saltar filas completamente vacías
    if (r.every(c => c == null || String(c).trim() === '')) continue
    const obj = {}
    headers.forEach((h, idx) => {
      if (!h) return
      obj[h] = r[idx]
    })
    // Guardamos el índice original de fila (1-based, considerando header)
    obj.__rowIndex = i + 1
    rows.push(obj)
  }
  return { rows, headers }
}

// Convierte cualquier cosa razonable que venga de Excel/CSV a "HH:MM" o ''.
// SheetJS entrega horas como strings "09:00" cuando se parsea con raw:false,
// pero a veces vienen como números decimales (0.375 = 09:00) o "9:00 a. m.".
export function coerceTime(v) {
  if (v == null) return ''
  const s = String(v).trim()
  if (!s) return ''
  // Si es número (fracción de día), convertir
  if (/^0?\.\d+$/.test(s) || /^\d+\.\d+$/.test(s)) {
    const n = parseFloat(s)
    if (n >= 0 && n < 1) {
      const totalMin = Math.round(n * 24 * 60)
      const h = Math.floor(totalMin / 60)
      const m = totalMin % 60
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  // 9:00, 09:00, 9:00:00, 9:00 a.m., etc.
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?$/i)
  if (!m) return s  // dejar que validateRow marque el error
  let h = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  const mer = (m[3] || '').toLowerCase().replace(/[.\s]/g, '')
  if (mer === 'pm' && h < 12) h += 12
  if (mer === 'am' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// Convierte fecha (cualquier representación) a YYYY-MM-DD o ''.
export function coerceDate(v) {
  if (v == null) return ''
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(v).trim()
  if (!s) return ''
  // Ya en YYYY-MM-DD
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`
  // DD/MM/YYYY o DD-MM-YYYY
  const m2 = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (m2) return `${m2[3]}-${String(m2[2]).padStart(2,'0')}-${String(m2[1]).padStart(2,'0')}`
  return s
}

export function coerceBool(v) {
  if (v == null) return false
  const s = String(v).trim().toLowerCase()
  return ['si','sí','yes','true','1','x','verdadero'].includes(s)
}

// Valida una sola fila ya normalizada y devuelve { errors, warnings, normalized }.
// - errors  → la fila no se importa
// - warnings → la fila se importa pero se muestra en amarillo
// - normalized → versión lista para enviar al API
export function validateRow(row, ctx = {}) {
  const errors = []
  const warnings = []
  const today = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  const nombre = String(row.nombre || '').trim()
  if (!nombre) errors.push('Nombre requerido')
  else if (nombre.length < 2) errors.push('Nombre muy corto')

  const codigo = String(row.codigo || '').trim().toUpperCase()
  if (codigo && !/^[A-Z0-9_-]{1,20}$/.test(codigo)) {
    errors.push('Código inválido (solo letras, números, _ y -)')
  }

  const pin = String(row.pin || '').trim()
  if (!pin) errors.push('PIN requerido')
  else if (!/^\d{4}$/.test(pin)) errors.push('PIN debe ser exactamente 4 dígitos')

  const salario = row.salario_mensual === '' || row.salario_mensual == null
    ? 0
    : Number(String(row.salario_mensual).replace(/[, $]/g, ''))
  if (!Number.isFinite(salario) || salario < 0) errors.push('Salario inválido')

  const tipoPago = String(row.tipo_pago || 'efectivo').trim().toLowerCase()
  if (!['efectivo', 'transferencia'].includes(tipoPago)) {
    errors.push('tipo_pago debe ser efectivo o transferencia')
  }

  const fechaIngreso = coerceDate(row.fecha_ingreso)
  if (!fechaIngreso) errors.push('fecha_ingreso requerida')
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaIngreso)) errors.push('fecha_ingreso inválida (usa YYYY-MM-DD)')
  else if (fechaIngreso > todayISO) errors.push('fecha_ingreso no puede ser futura')

  const fechaNacimiento = coerceDate(row.fecha_nacimiento)
  if (fechaNacimiento) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento)) errors.push('fecha_nacimiento inválida (usa YYYY-MM-DD)')
    else if (fechaNacimiento > todayISO) errors.push('fecha_nacimiento no puede ser futura')
  }

  // Mixto: horario_mixto (bool) + horas_diarias (numérico 1-24).
  // Si horario_mixto = sí, se IGNORA el schedule semanal del archivo y se
  // requiere horas_diarias. Validamos también que el tenant tenga el modo
  // activado y no supere el límite (ctx.mixedCfg + ctx.mixedCount).
  const isMixed = coerceBool(row.horario_mixto)
  let dailyHours = null
  if (isMixed) {
    if (ctx.mixedCfg && !ctx.mixedCfg.enabled) {
      errors.push('horario_mixto=sí pero el modo no está activado en Configuración')
    }
    const dhRaw = row.horas_diarias === '' || row.horas_diarias == null
      ? null
      : Number(String(row.horas_diarias).replace(',', '.'))
    if (dhRaw == null || !Number.isFinite(dhRaw)) {
      errors.push('horas_diarias requerido para empleados mixtos (1-24)')
    } else if (dhRaw <= 0 || dhRaw > 24) {
      errors.push('horas_diarias fuera de rango (1-24)')
    } else {
      dailyHours = dhRaw
    }
  }

  // Schedule: para empleados fijos, validar que si hay inicio haya fin y
  // viceversa, que estén en HH:MM y que end > start. Para mixtos, schedule
  // queda todo en work:false (no aplica).
  const schedule = {}
  let anyWorkingDay = false
  for (const d of DAYS) {
    const startRaw = row[`${d}_inicio`]
    const endRaw = row[`${d}_fin`]
    const start = coerceTime(startRaw)
    const end = coerceTime(endRaw)

    const hasStart = !!start
    const hasEnd = !!end

    if (!hasStart && !hasEnd) {
      schedule[d] = { work: false, start: '09:00', end: '18:00', custom: false }
      continue
    }
    if (hasStart !== hasEnd) {
      errors.push(`${d}: falta ${hasStart ? 'hora de salida' : 'hora de entrada'}`)
      schedule[d] = { work: false, start: '09:00', end: '18:00', custom: false }
      continue
    }
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      errors.push(`${d}: formato de hora inválido (usa HH:MM)`)
      continue
    }
    const [h1, m1] = start.split(':').map(Number)
    const [h2, m2] = end.split(':').map(Number)
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) {
      errors.push(`${d}: hora fuera de rango`)
      continue
    }
    if (h2 * 60 + m2 <= h1 * 60 + m1) {
      errors.push(`${d}: hora de salida debe ser mayor que entrada`)
      continue
    }
    schedule[d] = { work: true, start, end, custom: false }
    anyWorkingDay = true
  }
  // Regla "al menos 1 día" solo aplica a empleados fijos.
  if (!isMixed && !anyWorkingDay && errors.length === 0) {
    errors.push('Debe tener al menos 1 día con horario (L-D todos vacíos = sin turno)')
  }
  // Mixto ignora cualquier schedule que traiga el archivo: lo reseteamos.
  if (isMixed) {
    for (const d of DAYS) {
      schedule[d] = { work: false, start: '09:00', end: '18:00', custom: false }
    }
  }

  // Duplicados dentro del archivo
  if (codigo && ctx.codesInFile && ctx.codesInFile.has(codigo)) {
    errors.push(`Código ${codigo} repetido en el archivo`)
  }
  if (pin && ctx.pinsInFile && ctx.pinsInFile.has(pin)) {
    errors.push(`PIN ${pin} repetido en el archivo`)
  }

  // Duplicados contra BD (cuando el validador server pasa estos sets)
  if (codigo && ctx.codesInDb && ctx.codesInDb.has(codigo)) {
    errors.push(`Código ${codigo} ya existe — se omitirá`)
  }
  if (pin && ctx.pinsInDb && ctx.pinsInDb.has(pin)) {
    errors.push(`PIN ${pin} ya existe en otro empleado — se omitirá`)
  }

  const normalized = {
    codigo: codigo || null,
    nombre,
    departamento: String(row.departamento || '').trim(),
    puesto: String(row.puesto || 'Empleado').trim() || 'Empleado',
    pin,
    salario_mensual: salario,
    puede_administrar: coerceBool(row.puede_administrar),
    tipo_pago: tipoPago,
    fecha_ingreso: fechaIngreso,
    fecha_nacimiento: fechaNacimiento || null,
    is_mixed: isMixed,
    daily_hours: isMixed ? dailyHours : null,
    schedule,
  }

  return { errors, warnings, normalized, rowIndex: row.__rowIndex }
}

// Valida una lista de filas de golpe detectando duplicados internos.
// ctx opcional:
//   - codesInDb / pinsInDb   → Sets para detectar duplicados vs. BD
//   - mixedCfg { enabled, maxRotating, unlimitedRotating } → config del tenant
//   - mixedCount (int)       → número actual de mixtos existentes en BD
// Cuando se pasa mixedCfg+mixedCount, se valida que el total (existentes +
// mixtos en el archivo) no supere maxRotating si unlimitedRotating=false.
export function validateRows(rows, ctx = {}) {
  const codesInFile = new Set()
  const pinsInFile = new Set()
  const dupCodes = new Set()
  const dupPins = new Set()

  // Primer barrido: detectar duplicados intra-archivo
  for (const r of rows) {
    const c = String(r.codigo || '').trim().toUpperCase()
    const p = String(r.pin || '').trim()
    if (c) {
      if (codesInFile.has(c)) dupCodes.add(c)
      codesInFile.add(c)
    }
    if (p) {
      if (pinsInFile.has(p)) dupPins.add(p)
      pinsInFile.add(p)
    }
  }

  // Segundo barrido: validar cada fila con info de duplicados + BD
  const results = rows.map(r => validateRow(r, {
    ...ctx,
    codesInFile: dupCodes,
    pinsInFile: dupPins,
  }))

  // Validación global del límite de mixtos: solo filas sin errores que sean
  // mixtas suman al total. Si ya existen X en BD y el límite es Y, las filas
  // mixtas a partir de la (Y-X+1)-ésima se marcan con error.
  if (ctx.mixedCfg?.enabled && !ctx.mixedCfg.unlimitedRotating && ctx.mixedCfg.maxRotating != null) {
    const limit = Number(ctx.mixedCfg.maxRotating)
    const existing = Number(ctx.mixedCount || 0)
    let running = existing
    for (const r of results) {
      if (r.errors.length > 0) continue
      if (!r.normalized?.is_mixed) continue
      if (running >= limit) {
        r.errors.push(`Supera el límite de empleados mixtos (${limit}). Ya hay ${existing} y este archivo agrega más.`)
      } else {
        running++
      }
    }
  }

  return results
}

// Arma el JSONB schedule con el mismo shape que usa la UI manual
// (incluye branch + hireDate + vacationYearsTaken = [] por consistencia).
export function buildSchedulePayload(schedule, branch, fechaIngreso) {
  return {
    ...schedule,
    branch: branch ? { id: branch.id, name: branch.name } : null,
    hireDate: fechaIngreso || null,
    vacationYearsTaken: [],
  }
}
