'use client'

import { Building2 } from 'lucide-react'

export default function BranchFilter({
  branches = [],
  value = 'all',
  onChange,
  label = 'Sucursal',
  allLabel = 'Todas las sucursales',
  disabled = false,
  className = '',
}) {
  if (!branches.length) return null

  return (
    <label className={`inline-flex items-center gap-2 rounded-xl border border-dark-border bg-dark-800 px-3 py-2 shadow-sm ${className}`}>
      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-gray-500">
        <Building2 size={13} /> {label}
      </span>
      <select
        className="min-w-[180px] bg-transparent text-sm font-semibold text-white outline-none disabled:opacity-60"
        value={value || 'all'}
        onChange={e => onChange?.(e.target.value)}
        disabled={disabled}
      >
        {!disabled && <option value="all">{allLabel}</option>}
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  )
}
