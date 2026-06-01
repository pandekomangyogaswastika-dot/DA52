/**
 * Portal Navigation Configuration — PortalShell.jsx companion
 *
 * Pure data + helper functions (no React imports). Contains:
 *   - PORTAL_LABEL: portal id -> display label
 *   - PORTAL_NAV:   portal id -> { title, sections: [...] }
 *   - sectionContainsModule, sectionFlatItems, findModuleLabel, formatSectionLabel
 *
 * IMPORTANT: `findModuleLabel` is RE-EXPORTED by `PortalShell.jsx` for backward
 * compatibility (it is referenced via `import { findModuleLabel } from '../erp/PortalShell'`
 * in legacy code). Do not rename.
 */

import {
  // Dashboards
  LayoutDashboard, Gauge, LineChart, Warehouse, UserCog,
  // Management / Admin
  TrendingUp, FileSpreadsheet, Shirt, UserCircle2, Users,
  KeyRound, History, Building2, FileCog, BookOpen, UserPlus, GraduationCap, Palette,
  // Production operational
  LayoutGrid, ClipboardList, ClipboardSignature, Boxes,
  Hammer, UserCheck, Activity, Siren, AlertTriangle, Truck, Tv2, Zap,
  ClipboardPen, Package, CalendarDays,
  // Production process stages
  Link2, Scissors, ClipboardCheck, Droplets, PackageOpen, RotateCcw, Paintbrush,
  // Production master
  Workflow, Timer, Wrench, Factory, HardHat, Ruler, BookMarked,
  // Warehouse
  Archive, PackageMinus, PackagePlus, ArrowRightLeft, MapPin, Sparkles, Lock, Award, Send,
  // Finance — Accounting Core
  FolderTree, BookCheck, Scale, Book, CalendarRange, Settings2,
  FileText, Hourglass, Wallet,
  // Finance — Operasional (Session #11.17: Files/CreditCard/FilePlus removed — unused after legacy finance cleanup)
  ReceiptText, Landmark, Receipt, PieChart, Calculator, HandCoins,
  Banknote, BarChart3, Shield, ShieldAlert,
  // HR
  Clock, Contact, Calendar, Briefcase,
  // AI & Self
  Brain, Target, UserCircle, CheckSquare, Settings,
  // New portals (Maklon + Toko)
  Star, MessageSquare, ShoppingCart, Bell, Store, Scan,
  // Phase 5 — Catalog + Marketing (Week 4-7)
  Layers, ShoppingBag, AlertCircle, HeartPulse, Video,
  // Phase 3 Week 8-10 — Content Calendar, Discounts, Product Launch
  Tag, Rocket,
  // Phase 3 Week 13 — Fitur Internal
  ThumbsUp, PackageSearch, PackageCheck,
  // Session 12 — AI Content Tools & KOL Leaderboard
  Trophy, Image as ImageIcon,
  // Session 15 — HR AI & Portal Saya Extensions
  FileSearch, TrendingDown, Lightbulb, FileText as FileTextIcon, MessageSquare as MessageSquareIcon,
  // Session 26 — Portal RnD icons
  FlaskConical, Beaker,
  // Session 28 — LiveHost Management icon
  Radio,
  // Session 29 (Phase 26) — HR Approval Inbox icon
  Inbox,
  // Input Harian Sederhana
  PenLine,
  // Employee Expense Management (EEM)
  CreditCard, Plane, Database,
} from 'lucide-react';

// Portal labels shown as badge next to brand (top-left). Click brand to go back to selector.
export const PORTAL_LABEL = {
  management: 'Manajemen',
  production:  'Produksi',
  warehouse:   'Gudang',
  accessories: 'Aksesoris',  // Session #11.21 - Dedicated portal untuk accessories
  finance:     'Keuangan',
  hr:          'SDM / HRIS',
  maklon:      'Maklon',
  toko:        'Marketing',
  rnd:         'RnD & Desain',
  self:        'Portal Saya',
  collaboration: 'Portal Kolaborasi',
  assets:      'Manajemen Aset',
};

// ── CV. Dewi Aditya · Portal-specific navigation ────────────────────────
// Rules:
//   - Bahasa Indonesia untuk label menu (istilah teknis dipertahankan jika tidak ada padanan).
//   - Setiap ikon UNIK agar mudah dibedakan secara visual (rule from UX audit).
//   - Tidak ada moduleId duplikat antar portal (enforced by registry).
//   - Sections mendukung dua mode:
//       { items: [...] }  — list datar (default)
//       { groups: [{label, items}, ...] }  — dikelompokkan dengan sub-header di sidebar
export const PORTAL_NAV = {
  management: {
    title: 'Manajemen',
    sections: [
      {
        label: 'RINGKASAN',
        items: [
          { id: 'management-dashboard',  label: 'Dashboard Eksekutif',     icon: LayoutDashboard },
          { id: 'unified-approval-hub',  label: 'Pusat Approval Terpadu',  icon: Layers, badge: 'HUB' },
          { id: 'mgmt-overview',         label: 'Ringkasan Bisnis',        icon: TrendingUp },
          { id: 'phase7-reports',        label: 'Laporan & Dashboard (Maklon/CMT)', icon: BarChart3 },
          { id: 'mgmt-reports',          label: 'Laporan',                 icon: FileSpreadsheet },
          { id: 'mgmt-rahaza-customers', label: 'Data Pelanggan',          icon: UserCircle2 },
          { id: 'rnd-dashboard',         label: 'Portal RnD',              icon: FlaskConical },
        ],
      },
      {
        label: 'SISTEM',
        items: [
          { id: 'mgmt-users',        label: 'Manajemen Pengguna',   icon: Users },
          { id: 'mgmt-roles',        label: 'Manajemen Peran',       icon: Shield },
          { id: 'mgmt-role-matrix',  label: 'Matriks Hak Akses',    icon: KeyRound },
          { id: 'mgmt-activity',     label: 'Log Aktivitas',         icon: History },
          { id: 'mgmt-company',      label: 'Pengaturan Perusahaan', icon: Building2 },
          { id: 'mgmt-pdf',          label: 'Konfigurasi PDF',       icon: FileCog },
          { id: 'mgmt-integrations', label: 'Integrasi & API Keys',  icon: Zap },
          { id: 'mgmt-help',         label: 'Panduan Penggunaan',    icon: BookOpen },
        ],
      },
      {
        label: 'TOOLS & DIGEST',
        items: [
          { id: 'mgmt-tools',            label: 'Weekly Digest & Audit',    icon: BarChart3 },
          // Dashboard 13→12 (Session DA46): ai-business-dashboard diintegrasikan ke management-dashboard
          // Akses via tab "AI Business" di Management Dashboard — tidak lagi muncul sebagai sidebar terpisah
          { id: 'mgmt-okr',              label: 'Strategic OKR Tracker',    icon: Target },
          { id: 'ai-usage-monitor',      label: 'AI Usage Monitor',         icon: Activity },
        ],
      },
    ],
  },

  production: {
    title: 'Produksi',
    sections: [
      {
        label: 'OPERASIONAL HARIAN',
        groups: [
          {
            label: '📊 Dashboard & Pengiriman',
            items: [
              { id: 'production-dashboard', label: 'Dashboard Produksi',           icon: Gauge },
              { id: 'prod-control-tower',   label: 'Control Tower',                 icon: Factory, badge: 'BARU' },
              // P2 Consolidation #12 (Session #11.8): `prod-shipments` removed from sidebar.
              // Use `wms-delivery-notes` (Surat Jalan Customer — SSOT) in Warehouse portal.
              // Old route still reachable via Command Palette or deep link.
            ],
          },
          {
            label: '⚡ Quick Actions',
            items: [
              { id: 'prod-wizard',        label: 'Production Wizard',       icon: Zap },
              { id: 'prod-bulk-mi',       label: 'Material Issue (Bulk)',    icon: ClipboardPen },
              { id: 'prod-simple-input',  label: 'Input Harian Sederhana',  icon: PenLine, badge: 'BARU' },
            ],
          },
          {
            label: '📋 Order & Penjadwalan',
            items: [
              { id: 'prod-orders',               label: 'Order Produksi',      icon: ClipboardList },
              { id: 'prod-work-orders',           label: 'Work Order',          icon: ClipboardSignature },
              { id: 'prod-bundles',               label: 'Penelusuran Bundle',  icon: Boxes },
              { id: 'prod-material-reservation',  label: 'Reservasi Material',  icon: Lock },
              { id: 'prod-material-returns',      label: 'Return Material',       icon: RotateCcw, badge: 'BARU' },
            ],
          },
          {
            label: '🏭 Eksekusi Lantai Produksi',
            items: [
              { id: 'prod-cutting',        label: 'Cutting Hub',          icon: Scissors, badge: 'HUB' },
              { id: 'prod-assignments',    label: 'Assign Lini Hari Ini', icon: UserCheck },
              { id: 'prod-shift-handover', label: 'Serah Terima Shift',   icon: Package },
              { id: 'prod-rework-board',   label: 'Papan Rework',         icon: Hammer },
            ],
          },
        ],
      },
      {
        label: 'PROSES INTI (4 TAHAP)',
        groups: [
          {
            label: 'Tahap Produksi',
            items: [
              // NOTE (Session #11 cont. / P2 Consolidation #2):
              // 'prod-exec-cutting' removed from sidebar — Cutting Planning + Execution
              // now consolidated under 'prod-cutting' (Cutting Hub). The route
              // 'prod-exec-cutting' still works (kept in moduleRegistry for backward compat).
              { id: 'prod-exec-sewing',    label: '1 · Jahit (CMT)',  icon: Link2 },
              { id: 'prod-exec-finishing', label: '2 · Finishing',    icon: Droplets },
              { id: 'prod-exec-qc',        label: '3 · QC Final',     icon: ClipboardCheck },
              { id: 'prod-exec-packing',   label: '4 · Packing',      icon: PackageOpen },
            ],
          },
          {
            label: 'CMT & Sub-Proses',
            items: [
              { id: 'prod-cmt',                              label: 'Manajemen CMT',         icon: Factory },
              { id: 'cmt-lifecycle',                         label: 'CMT Lifecycle Dashboard', icon: Briefcase },
              { id: 'cmt-progress',                          label: 'Progress CMT & DO',     icon: BarChart3 },
              { id: 'prod-cmt-packing',                     label: 'Packing & Opname CMT', icon: PackageCheck },
              { id: 'production-cmt-component-requests',    label: 'Kekurangan Komponen',  icon: PackageSearch },
              { id: 'prod-exec-rework',                     label: 'Rework / Revisi',      icon: RotateCcw },
            ],
          },
        ],
      },
      {
        label: 'MONITORING & ANALYTICS',
        groups: [
          {
            label: 'Real-time',
            items: [
              { id: 'prod-monitoring',     label: 'Live Monitoring',      icon: Activity, badge: 'BARU' },
              { id: 'prod-line-board',     label: 'Papan Lini Real-time', icon: LayoutGrid },
              { id: 'prod-andon-board',    label: 'Papan Andon',          icon: AlertTriangle },
              { id: 'prod-alert-settings', label: 'Pengaturan Alert',     icon: Siren },
            ],
          },
          {
            label: 'Quality Analytics',
            items: [
              { id: 'prod-pareto',         label: 'Pareto Cacat',           icon: BarChart3 },
              { id: 'prod-fpy',            label: 'First Pass Yield (FPY)', icon: Target },
              { id: 'prod-aql-calculator', label: 'AQL Sampling Tool',      icon: Shield },
            ],
          },
          {
            label: 'Performance & AI',
            items: [
              { id: 'prod-downtime',                label: 'Log Downtime Mesin',     icon: Activity },
              { id: 'prod-backlog',                 label: 'Backlog & Forecast',     icon: TrendingUp },
              { id: 'prod-capacity-planning',       label: 'Perencanaan Kapasitas',  icon: BarChart3 },
              { id: 'prod-ai-insights',             label: 'AI Insights & Chatbot',  icon: Brain },
              { id: 'ai-actions',                   label: 'AI Action Items',        icon: CheckSquare },
              { id: 'prod-predictive-maintenance',  label: 'Predictive Maintenance', icon: Wrench, badge: 'AI' },
            ],
          },
        ],
      },
      {
        label: 'MASTER DATA',
        groups: [
          {
            label: '📍 Lokasi & Workspace',
            items: [
              { id: 'prod-workspace-master', label: 'Master Workspace', icon: Building2 },
            ],
          },
          {
            label: '📐 Proses & Standar',
            items: [
              { id: 'prod-processes',           label: 'Proses Produksi',    icon: Workflow },
              { id: 'prod-sop',                 label: 'SOP Produksi',       icon: BookMarked },
              { id: 'prod-defect-codes',        label: 'Master Kode Cacat',  icon: ShieldAlert },
              { id: 'prod-production-calendar', label: 'Kalender Produksi',  icon: CalendarDays },
            ],
          },
          {
            label: '👕 Produk & Tim',
            items: [
              { id: 'prod-models-bom', label: 'Master Produk & BOM',    icon: Shirt },
              { id: 'prod-employees',  label: 'Operator & Skill Matrix', icon: HardHat },
            ],
          },
        ],
      },
    ],
  },

  warehouse: {
    title: 'Gudang',
    sections: [
      {
        label: 'INVENTORI',
        items: [
          { id: 'warehouse-dashboard', label: 'Dashboard Gudang',              icon: Warehouse },
          { id: 'wh-master',           label: 'Master Item (Material & FG)',   icon: Boxes },
          { id: 'wh-stock',            label: 'Stok & Pergerakan',             icon: Archive },
          { id: 'wh-material-issue',   label: 'Material Issue',                icon: PackageMinus },
          { id: 'unified-inventory',   label: 'Unified Inventory Viewer',      icon: Boxes },
        ],
      },
      {
        label: 'OPERASIONAL GUDANG',
        items: [
          { id: 'wh-purchase-orders',           label: 'Purchase Order (PO)',             icon: FileText },
          { id: 'wh-receiving',                 label: 'Penerimaan Barang (GRN)',         icon: PackagePlus },
          // P2 Consolidation #12 (Session #11.8): `do-management` removed from sidebar.
          // Use `wms-cmt-dispatches` (Dispatch ke CMT — SSOT) in 'GARMENT WMS' section.
          // Old route still reachable via Command Palette or deep link.
          { id: 'fulfillment',                  label: 'Fulfillment (Order → FG Out)',    icon: Send },
          { id: 'wh-supplier-scorecard',        label: 'Supplier Scorecard & AQL',       icon: Award },
          { id: 'wh-putaway',                   label: 'Put-Away',                        icon: ArrowRightLeft },
          { id: 'wh-picklist',                  label: 'Pick List',                       icon: ClipboardList },
          { id: 'wh-opname',                    label: 'Stok Opname',                    icon: ClipboardCheck },
          { id: 'wh-bin',                        label: 'Lokasi / Bin',                   icon: MapPin },
          { id: 'wh-accessory-ops',             label: 'Transaksi Aksesoris',            icon: Sparkles },
          { id: 'warehouse-accessory-requests', label: 'Inbox Request Aksesoris', icon: PackageSearch, badge: 'RESMI' },
          { id: 'wh-returns',                   label: 'Return & Refund',                icon: RotateCcw },
          { id: 'warehouse-smart',              label: 'Alert, Reorder & Undo',          icon: AlertTriangle },
        ],
      },
      {
        label: 'GARMENT WMS (ADVANCED)',
        items: [
          { id: 'wms',                label: 'WMS Scanner (Barcode)',          icon: Scan },
          { id: 'wms-fabric-rolls',   label: 'Fabric Roll Tracking',          icon: Package },
          // P2 Consolidation #12 (Session #11.8): renamed to mark as SSOT
          { id: 'wms-delivery-notes', label: 'Surat Jalan Customer',   icon: FileText, badge: 'RESMI' },
          { id: 'wms-cmt-dispatches', label: 'Dispatch ke CMT',         icon: Truck,    badge: 'RESMI' },
          { id: 'wms-opname-enhanced',label: 'Opname Stok',             icon: BarChart3, badge: 'RESMI' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PORTAL AKSESORIS — MVP (8 menu, Session #11.21 rewrite)
  // ═══════════════════════════════════════════════════════════════════════════
  accessories: {
    title: 'Aksesoris',
    sections: [
      {
        label: 'DASHBOARD',
        items: [
          { id: 'accessories-dashboard', label: 'Dashboard Aksesoris', icon: LayoutDashboard },
        ],
      },
      {
        label: 'INVENTORI',
        items: [
          { id: 'accessories-master-stock', label: 'Master & Stok Aksesoris', icon: Package },
          { id: 'accessories-opname',       label: 'Stok Opname',             icon: ClipboardCheck },
        ],
      },
      {
        label: 'REQUEST & PEMINJAMAN',
        items: [
          { id: 'accessories-internal-request', label: 'Request Internal',       icon: ArrowRightLeft },
          { id: 'accessories-inbox',            label: 'Inbox Approval Request', icon: Inbox, badge: 'RESMI' },
          { id: 'accessories-loans',            label: 'Peminjaman Aksesoris',   icon: RotateCcw },
        ],
      },
      {
        label: 'PENGADAAN',
        items: [
          { id: 'accessories-purchase', label: 'Purchase Request (PR)', icon: ShoppingCart },
        ],
      },
      {
        label: 'LAPORAN',
        items: [
          { id: 'accessories-reports', label: 'Laporan Aksesoris', icon: BarChart3 },
        ],
      },
    ],
  },

  finance: {
    title: 'Keuangan',
    sections: [
      {
        label: 'TRANSAKSI (AR & AP)',
        groups: [
          {
            label: '📥 Piutang (AR)',
            items: [
              { id: 'finance-dashboard', label: 'Dashboard Keuangan',    icon: LineChart },
              { id: 'fin-ar-invoices',   label: 'Invoice Penjualan (AR)', icon: ReceiptText },
              { id: 'fin-ar-360',        label: 'AR 360° (Aging & Statement)', icon: Scale, badge: 'RESMI' },
              // Session #11.17: Legacy 'fin-ar' (Daftar Piutang) + 'fin-invoices' (Rekap Invoice)
              // REMOVED — superseded by fin-ar-invoices + fin-ar-360 above (both SSOT).
            ],
          },
          {
            label: '🛒 Pengadaan (P2P)',
            items: [
              { id: 'fin-procurement-requests', label: 'Permintaan Pengadaan (PR)', icon: ShoppingCart, badge: 'BARU' },
              { id: 'fin-3way-match',     label: '3-Way Match (PO/GR/Inv)', icon: Scale, badge: 'BARU' },
              { id: 'fin-approval',       label: 'Persetujuan Invoice',  icon: ShieldAlert },
              // Session #11.17: Legacy 'fin-ap' (Hutang Vendor) + 'fin-manual-invoice' (Invoice Manual)
              // REMOVED — superseded by fin-ap-aging (SSOT, in "Arus Kas, Aging & Aset" section below).
            ],
          },
        ],
      },
      {
        label: 'KAS & PEMBAYARAN',
        items: [
          { id: 'fin-cash',           label: 'Kas & Bank',               icon: Landmark },
          { id: 'fin-petty-cash',     label: 'Kas Kecil',                icon: Wallet },
          { id: 'fin-bank-transfer',  label: 'Transfer Bank',            icon: ArrowRightLeft },
          { id: 'fin-bank-recon',     label: 'Rekonsiliasi Bank',        icon: ArrowRightLeft },
          { id: 'fin-ai-cashflow',    label: 'AI Cash Flow Prediction',  icon: Brain },
          { id: 'fin-expenses',       label: 'Pengeluaran',              icon: Receipt },
          { id: 'fin-expense-settlement', label: 'Klaim Karyawan (Disbursement)', icon: CreditCard },
          { id: 'fin-settlement-queue',   label: 'Queue Settlement Dinas',        icon: FileText },
        ],
      },
      {
        label: 'AKUNTANSI & LAPORAN',
        groups: [
          {
            label: 'Biaya & HPP',
            items: [
              { id: 'fin-cost-centers', label: 'Pusat Biaya',    icon: PieChart },
              { id: 'fin-hpp',          label: 'HPP / Costing',  icon: Calculator },
              { id: 'fin-recap',        label: 'Rekap Keuangan', icon: BarChart3 },
            ],
          },
          {
            label: 'Master & Jurnal',
            items: [
              { id: 'fin-coa',              label: 'Bagan Akun (COA)',  icon: FolderTree },
              { id: 'fin-journal-entry',    label: 'Jurnal Umum',       icon: BookCheck },
              { id: 'fin-journal-list',     label: 'Daftar Jurnal',     icon: FileText },
              { id: 'fin-posting-profiles', label: 'Profil Posting GL', icon: Settings2 },
              { id: 'fin-gl-mapping-config', label: 'GL Mapping (Expense)', icon: Settings2 },
              { id: 'fin-expense-category-master', label: 'Master Kategori Expense', icon: Tag },
              { id: 'fin-periods',          label: 'Periode Akuntansi', icon: CalendarRange },
            ],
          },
          {
            label: 'Laporan Keuangan',
            items: [
              { id: 'fin-trial-balance',  label: 'Neraca Saldo (TB)', icon: Scale },
              { id: 'fin-general-ledger', label: 'Buku Besar (GL)',   icon: Book },
              { id: 'fin-pnl',            label: 'Laba Rugi (P&L)',   icon: TrendingUp },
              { id: 'fin-balance-sheet',  label: 'Neraca',            icon: BarChart3 },
            ],
          },
          {
            label: 'Arus Kas, Aging & Aset',
            items: [
              { id: 'fin-cash-flow',       label: 'Laporan Arus Kas',         icon: Wallet },
              { id: 'fin-ap-aging',        label: 'Aging Hutang (AP)',         icon: Hourglass },
              { id: 'fin-budget',          label: 'Anggaran (Budget)',         icon: PieChart },
              { id: 'fin-fixed-assets',    label: 'Aset Tetap & Depresiasi',  icon: Package },
              { id: 'fin-executive-report',label: 'Executive Report Hub',     icon: BarChart3, badge: 'BETA' },
            ],
          },
          {
            label: 'Setup & Master Data',
            items: [
              { id: 'admin-setup-panel', label: 'Admin Setup Panel (COA/Profiles)', icon: Database, badge: 'Phase 7' },
            ],
          },
        ],
      },
    ],
  },

  hr: {
    title: 'SDM',
    sections: [
      {
        label: 'KARYAWAN & ORGANISASI',
        items: [
          { id: 'hr-dashboard',  label: 'Dashboard SDM',           icon: UserCog },
          { id: 'unified-approval-hub', label: 'Pusat Approval Terpadu', icon: Layers, badge: 'HUB' },
          { id: 'hr-inbox',      label: 'Inbox Approval SDM',      icon: Inbox },
          { id: 'approval-multilevel', label: 'Approval Multi-Level', icon: CheckSquare },
          { id: 'hr-shift-management', label: 'Manajemen Shift',       icon: Clock },
          { id: 'hr-employees',  label: 'Data Karyawan & Kontrak', icon: Users },
          { id: 'hr-org-chart',  label: 'Struktur Organisasi',     icon: LayoutGrid },
          { id: 'hr-assets',     label: 'Aset Karyawan',           icon: Package },
          { id: 'hr-admin',      label: 'HR Admin & Seed',         icon: Settings },
        ],
      },
      {
        label: 'REKRUTMEN & TALENT',
        items: [
          { id: 'recruitment-process-header', label: '📋 Proses Rekrutmen',      icon: UserPlus,       isHeader: true },
          { id: 'hr-recruitment',             label: 'Job Posting & ATS',        icon: FileText,       indent: 1 },
          { id: 'hr-resume-screening',        label: 'AI Resume Screening',      icon: FileSearch,     badge: 'AI', indent: 1 },
          { id: 'onboarding-header',          label: '👋 Onboarding',            icon: ClipboardCheck, isHeader: true },
          { id: 'hr-onboarding',              label: 'Onboarding Checklist',     icon: ClipboardCheck, indent: 1 },
          { id: 'career-header',              label: '💼 Career Development',    icon: Briefcase,      isHeader: true },
          { id: 'hr-job-board',               label: 'Internal Job Board',       icon: Briefcase,      indent: 1 },
        ],
      },
      {
        label: 'KEHADIRAN & SHIFT',
        items: [
          { id: 'attendance-header',      label: '⏰ Absensi & Clock In/Out', icon: Clock,       isHeader: true },
          { id: 'hr-attendance',          label: 'Absensi Harian (Manual)',  icon: Clock,       indent: 1 },
          { id: 'hr-auto-attendance',     label: 'Absen Otomatis',           icon: Scan,        indent: 1 },
          { id: 'hr-attendance-approval', label: 'Approval Absen',           icon: CheckSquare, indent: 1 },
          { id: 'shift-header',           label: '📅 Shift & Jadwal Kerja',  icon: Calendar,    isHeader: true },
          { id: 'hr-shift-scheduler',     label: 'Auto Shift Scheduler',     icon: Calendar,    indent: 1 },
          { id: 'overtime-header',        label: '🌙 Lembur & Overtime',     icon: Hourglass,   isHeader: true },
          { id: 'hr-overtime',            label: 'Request Lembur',           icon: Hourglass,   indent: 1 },
          { id: 'leave-header',           label: '🏖️ Cuti & Izin',          icon: Calendar,    isHeader: true },
          { id: 'hr-leave',               label: 'Izin & Cuti',              icon: Calendar,    indent: 1 },
          { id: 'hr-leave-balances',      label: 'Saldo Cuti',               icon: CalendarDays, indent: 1 },
        ],
      },
      {
        label: 'KINERJA & PENGEMBANGAN',
        items: [
          { id: 'hr-performance-hub', label: 'Performance Management', icon: Target },
          { id: 'hr-lms',             label: 'Learning Management',     icon: GraduationCap },
        ],
      },
      {
        label: 'PENGGAJIAN',
        items: [
          { id: 'hr-payroll-dashboard',  label: 'Dashboard Payroll',         icon: BarChart3,  badge: 'BETA' },
          { id: 'hr-payroll-profiles',   label: 'Profil Gaji Karyawan',      icon: Contact },
          { id: 'hr-payroll-allowances', label: 'Tunjangan Tetap',           icon: HandCoins },
          { id: 'hr-salary-adjustments', label: 'Kenaikan Gaji (Approval)',  icon: TrendingUp },
          { id: 'hr-payroll-run',        label: 'Penggajian & Slip',         icon: Banknote },
        ],
      },
      {
        label: 'AI-POWERED HR & LAPORAN',
        items: [
          { id: 'ai-insights-header', label: '📊 AI Insights & Analytics', icon: Brain,        isHeader: true },
          { id: 'hr-ai-insights',     label: 'HR Dashboard dengan AI',     icon: Brain,        indent: 1 },
          { id: 'hr-attrition',       label: 'Predictive Attrition',       icon: TrendingDown, badge: 'AI', indent: 1 },
          { id: 'hr-skill-gap',       label: 'Skill Gap Analysis',         icon: Target,       indent: 1 },
          { id: 'ai-tools-header',    label: '🤖 AI Tools',                icon: Lightbulb,    isHeader: true },
          { id: 'hr-coaching',        label: 'Performance Coaching AI',    icon: Lightbulb,    badge: 'AI', indent: 1 },
          { id: 'ai-actions-header',  label: '⚡ Action Items',            icon: CheckSquare,  isHeader: true },
          { id: 'ai-actions',         label: 'Automated Recommendations',  icon: CheckSquare,  indent: 1 },
          { id: 'hr-reports',         label: 'Laporan & Analitik SDM',     icon: BarChart3 },
        ],
      },
      {
        label: 'KLAIM & PERJALANAN DINAS',
        items: [
          { id: 'hr-expense-claims',   label: 'Klaim Biaya Saya',            icon: Wallet,      indent: 0 },
          { id: 'hr-travel-requests',  label: 'Perjalanan Dinas Saya',       icon: Plane,       indent: 0 },
          { id: 'hr-travel-settlement', label: 'Settlement Perjalanan Dinas', icon: FileText,    indent: 0 },
          { id: 'hr-expense-approval', label: 'Approval Klaim & Dinas',      icon: CheckSquare, indent: 0 },
          { id: 'hr-per-diem-config',  label: 'Konfigurasi Per Diem',        icon: Settings2,   indent: 0 },
        ],
      },
    ],
  },

  rnd: {
    title: 'RnD & Desain',
    sections: [
      {
        label: 'STYLE & SAMPLING',
        items: [
          { id: 'rnd-dashboard',           label: 'Dashboard RnD',              icon: LayoutDashboard },
          { id: 'rnd-styles',              label: 'Style & Tech Pack',           icon: Palette },
          { id: 'rnd-variants',            label: 'Varian Produk (Color/Size)',  icon: Layers },
          { id: 'rnd-samples',             label: 'Sample Requests',             icon: FlaskConical },
          { id: 'rnd-revisions',           label: 'Revisi & Approval',           icon: ClipboardCheck },
          { id: 'rnd-accessory-requests',  label: 'Request Aksesoris',           icon: Package },
        ],
      },
      {
        label: 'MATERIAL, POLA & MARKING',
        items: [
          { id: 'rnd-materials', label: 'Material Research',         icon: Beaker },
          { id: 'rnd-patterns',  label: 'Dokumentasi Pola & Marking', icon: Ruler },
        ],
      },
      {
        label: 'TECH PACK, COSTING & AI',
        items: [
          { id: 'rnd-techpack',           label: 'Tech Pack Manager',       icon: FileText },
          { id: 'rnd-costing',            label: 'Sample Costing',          icon: Calculator },
          { id: 'rnd-hpp',                label: 'HPP Calculator',          icon: TrendingUp },
          { id: 'rnd-analytics',          label: 'RnD Analytics',           icon: BarChart3 },
          { id: 'rnd-kreator-requests',   label: 'Approve Kreator Request', icon: Users },
        ],
      },
    ],
  },

  self: {
    title: 'Portal Saya',
    sections: [
      {
        label: 'PROFIL & KEHADIRAN',
        items: [
          { id: 'portal-dashboard', label: 'Dashboard Saya',    icon: LayoutDashboard },
          { id: 'portal-profile',   label: 'Profil Saya',       icon: UserCircle },
          { id: 'self-dashboard',   label: 'Kehadiran Saya',    icon: Clock },
          { id: 'portal-cuti',      label: 'Cuti & Lembur',     icon: Calendar },
          { id: 'portal-notifikasi',label: 'Notifikasi Inbox',  icon: Bell },
        ],
      },
      {
        label: 'KOMPENSASI & KINERJA',
        items: [
          { id: 'portal-payslip',       label: 'Slip Gaji Saya',   icon: Banknote },
          { id: 'kpi-portal',           label: 'KPI Saya',         icon: Target },
          { id: 'portal-annual-review', label: 'My Annual Review', icon: Target },
        ],
      },
      {
        label: 'PENGEMBANGAN, KARIR & DOKUMEN',
        items: [
          { id: 'portal-training',      label: 'Training Saya',   icon: BookOpen },
          { id: 'portal-peer-feedback', label: 'Peer Feedback',   icon: MessageSquareIcon },
          { id: 'portal-career-coach',  label: 'AI Career Coach', icon: Brain,             badge: 'AI' },
          { id: 'portal-workspace',     label: 'My Workspace',    icon: Star },
          { id: 'portal-documents',     label: 'Dokumen Saya',    icon: FileTextIcon },
        ],
      },
    ],
  },

  maklon: {
    title: 'Maklon',
    sections: [
      {
        label: 'KLIEN & ORDER',
        items: [
          { id: 'maklon-dashboard', label: 'Dashboard Maklon',    icon: Package },
          { id: 'maklon-clients',   label: 'Data Klien Maklon',   icon: Users },
          { id: 'maklon-po',        label: 'PO Maklon',           icon: ClipboardList },
          { id: 'maklon-po-360',    label: 'PO 360° View',         icon: Layers, badge: 'BARU' },
          { id: 'maklon-samples',   label: 'Sample Management',   icon: ClipboardCheck },
          { id: 'maklon-tracking',  label: 'Tracking Produksi',   icon: Activity },
        ],
      },
      {
        label: 'VENDOR CMT',
        items: [
          { id: 'vendor-admin',     label: 'Kelola Vendor CMT',     icon: Building2 },
          { id: 'vendor-portal',    label: 'Portal Vendor',         icon: Briefcase, badge: 'VENDOR' },
        ],
      },
      {
        label: 'KEUANGAN & ANALITIK',
        items: [
          { id: 'maklon-billing',       label: 'Invoice & Billing',         icon: Banknote },
          { id: 'maklon-hpp',           label: 'HPP Jasa Jahit',            icon: Target },
          { id: 'maklon-ai-quote',      label: 'AI Quote Generator',        icon: Sparkles, badge: 'AI' },
          { id: 'maklon-qc',            label: 'QC & Reject',                icon: ClipboardCheck },
        ],
      },
      {
        label: 'PENGATURAN',
        items: [
          { id: 'maklon-notifications', label: 'Notification Center', icon: Bell },
          { id: 'maklon-config',        label: 'System Config',       icon: Settings2 },
        ],
      },
    ],
  },

  toko: {
    title: 'Marketing',
    sections: [
      {
        label: 'OPERASIONAL PENJUALAN',
        groups: [
          {
            label: '💼 Multi-Channel Sales',
            items: [
              { id: 'marketing-accounts',   label: 'Manage Accounts',        icon: Store },
              { id: 'marketing-sales',      label: 'Input Sales Harian',     icon: TrendingUp },
              { id: 'marketing-import',     label: 'Universal Smart Import', icon: FileSpreadsheet },
              { id: 'marketing-orders',     label: 'Unified Orders',         icon: ShoppingBag },
            ],
          },
          {
            label: '🏪 Marketplace & Katalog',
            items: [
              { id: 'marketing-catalog', label: 'Manajemen Katalog', icon: Layers },
            ],
          },
          {
            label: '⭐ KOL & Creator',
            items: [
              { id: 'marketing-kol',              label: 'KOL & Creator Mgmt',   icon: Star },
              { id: 'marketing-kreator-requests', label: 'Kreator Requests',     icon: Users },
              { id: 'marketing-livehost',         label: 'LiveHost Management',  icon: Radio },
            ],
          },
          {
            label: '📅 Konten & Kampanye',
            items: [
              { id: 'marketing-content-calendar', label: 'Content Calendar',       icon: Calendar },
              { id: 'marketing-discounts',        label: 'Discount Campaign',      icon: Tag },
              { id: 'marketing-product-launches', label: 'Product Launch Manager', icon: Rocket },
            ],
          },
        ],
      },
      {
        label: 'ANALYTICS & AI',
        groups: [
          {
            label: '📊 Laporan & Performa',
            items: [
              { id: 'marketing-reports',        label: 'Laporan & Analytics',     icon: BarChart3 },
              { id: 'marketing-health',         label: 'Account Health',          icon: HeartPulse },
              { id: 'marketing-live',           label: 'Live Sessions',           icon: Video },
              { id: 'marketing-live-analytics', label: 'Live Session Analytics',  icon: TrendingUp, badge: 'BETA' },
              { id: 'marketing-targets',        label: 'Target Bulanan',          icon: Target },
            ],
          },
          {
            label: '🤖 AI Tools',
            items: [
              { id: 'marketing-ai-insights',     label: 'AI Marketing Insights', icon: Brain },
              { id: 'marketing-advanced-ai',     label: 'Advanced AI Features',  icon: Sparkles },
              { id: 'marketing-ai-content',      label: 'AI Content Generator',  icon: Sparkles, badge: 'AI' },
              { id: 'marketing-ai-image',        label: 'AI Image Generator',    icon: ImageIcon, badge: 'AI' },
              { id: 'marketing-kol-leaderboard', label: 'KOL Leaderboard',       icon: Trophy },
              { id: 'marketing-scheduler',       label: 'Scheduler & Otomasi',   icon: Timer },
            ],
          },
        ],
      },
      {
        label: 'TASK MANAGEMENT',
        items: [
          { id: 'marketing-task-hub', label: 'Task Management Hub', icon: ClipboardCheck },
        ],
      },
      {
        label: 'AFTER SALES & SUPPORT',
        items: [
          { id: 'marketing-after-sales', label: 'Komplain & Returns',            icon: AlertCircle },
          { id: 'marketing-reviews',     label: 'Rating & Review Management',    icon: ThumbsUp },
          { id: 'marketing-samples',     label: 'Database Pengiriman Sample',    icon: PackageSearch },
        ],
      },
      {
        label: '💳 FINANCE BRIDGE',
        items: [
          { id: 'marketing-ar-bridge', label: 'Marketing Sales → AR Invoice', icon: FileText, badge: 'Phase 7' },
        ],
      },

      {
        label: 'PENGATURAN',
        items: [
          { id: 'marketing-integration-settings', label: 'API Integration Settings', icon: Settings },
          { id: 'marketing-webhooks',             label: 'Webhook Events Monitor',   icon: Zap },
          { id: 'maklon-notifications',           label: 'Notifikasi & Provider',    icon: Bell },
        ],
      },
    ],
  },

  // ─── Portal Kolaborasi — Communication + Workspace + Learning ────────────────
  collaboration: {
    title: 'Portal Kolaborasi',
    sections: [
      {
        label: 'KOLABORASI',
        items: [
          { id: 'collaboration',    label: 'Portal Kolaborasi',          icon: MessageSquare },
          { id: 'collab-workspace', label: 'My Workspace (Spreadsheet)', icon: FileText },
        ],
      },
    ],
  },

  // ─── Portal Manajemen Aset ───────────────────────────────────────
  assets: {
    title: 'Manajemen Aset',
    sections: [
      {
        label: 'ASET',
        items: [
          { id: 'asset-dashboard',   label: 'Dashboard Aset',     icon: LayoutDashboard },
          { id: 'asset-list',        label: 'Daftar Aset',        icon: Package },
          { id: 'asset-procurement', label: 'Request Pengadaan', icon: ShoppingCart },
        ],
      },
    ],
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

// Helper: apakah section mengandung moduleId (support items & groups)
export function sectionContainsModule(section, moduleId) {
  if (!section) return false;
  if (section.items?.some((i) => i.id === moduleId)) return true;
  if (section.groups?.some((g) => g.items?.some((i) => i.id === moduleId))) return true;
  return false;
}

// Helper: flatten section → list of items (menggabungkan groups)
export function sectionFlatItems(section) {
  if (!section) return [];
  if (section.items?.length) return section.items;
  if (section.groups?.length) return section.groups.flatMap((g) => g.items || []);
  return [];
}

// Helper: cari label menu berdasarkan currentModule (untuk topbar title)
export function findModuleLabel(portal, moduleId) {
  const nav = PORTAL_NAV[portal];
  if (!nav) return moduleId;
  for (const sec of nav.sections) {
    const all = sectionFlatItems(sec);
    const found = all.find((it) => it.id === moduleId);
    if (found) return found.label;
  }
  return moduleId;
}

// ── helper: tampilkan label section lebih enak dibaca (ALL CAPS → Title Case),
// preserve akronim di dalam tanda kurung DAN daftar akronim terkenal ──
const KNOWN_ACRONYMS = new Set([
  'HPP', 'AR', 'AP', 'SOP', 'BOM', 'OEE', 'QC', 'APS', 'KPI', 'ERP', 'TV', 'HR', 'WO',
]);

export function formatSectionLabel(label) {
  if (!label) return '';
  return label
    .split(' ')
    .map((w) => {
      if (!w) return '';
      // preserve acronyms within parens, e.g. (AR), (AP), (HPP), (F1)
      if (/^\(.+\)$/.test(w)) return w.toUpperCase();
      // preserve known acronyms (case-insensitive match)
      if (KNOWN_ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
      // everything else → Title Case (first letter upper, rest lower)
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}
