/**
 * Asset Management — Shared constants & status config
 * Extracted from AssetManagementPortal.jsx (Phase 1 refactor)
 */

export const STATUS_CONFIG = {
  active:           { label: 'Aktif',        color: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  in_maintenance:   { label: 'Pemeliharaan', color: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  disposed:         { label: 'Dilepas',      color: 'bg-red-500/15 text-red-600 border-red-500/30' },
  under_repair:     { label: 'Perbaikan',    color: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  pending_disposal: { label: 'Menunggu Disposal', color: 'bg-orange-500/15 text-orange-700 border-orange-500/30' },
};

export const PR_STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'bg-muted text-muted-foreground' },
  submitted: { label: 'Menunggu Dept', color: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  dept_approved: { label: 'Menunggu Finance', color: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  finance_approved: { label: 'Menunggu Final', color: 'bg-violet-500/15 text-violet-600 border-violet-500/30' },
  approved: { label: 'Disetujui', color: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
  in_procurement: { label: 'Sedang Pengadaan', color: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30' },
  completed: { label: 'Selesai', color: 'bg-emerald-700/15 text-emerald-700 border-emerald-700/30' },
  rejected: { label: 'Ditolak', color: 'bg-red-500/15 text-red-600 border-red-500/30' },
  cancelled: { label: 'Dibatalkan', color: 'bg-muted text-muted-foreground' },
};

export const PIE_COLORS = ['#6366f1','#22d3ee','#f59e0b','#ef4444','#10b981','#8b5cf6','#f97316'];

export const SEVERITY_CONFIG = {
  critical: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-600', label: 'Critical' },
  warning:  { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-600', label: 'Warning' },
  info:     { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-600', label: 'Info' },
};
