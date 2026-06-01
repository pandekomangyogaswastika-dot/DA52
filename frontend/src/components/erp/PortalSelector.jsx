import { useState } from 'react';
import { motion } from 'framer-motion';
import { GlassCard, GlassPanel } from '@/components/ui/glass';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import {
  BarChart3, Factory, Warehouse, Landmark, UserCog,
  Lock, LogOut, ChevronRight, UserCircle, BookOpen,
  ShoppingBag, Package, FlaskConical, MessageSquare, Boxes,
  FileSpreadsheet, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import UserGuideDialog from './userGuide/UserGuideDialog';

// Role → Portals mapping.
const PORTALS = [
  {
    id: 'management',
    name: 'Portal Manajemen',
    description: 'Dashboard eksekutif, master produk/pelanggan, RnD & Style, Marketing KOL, dan administrasi sistem.',
    icon: BarChart3,
    accent: 'primary',
    roles: ['admin', 'owner', 'manager_produksi', 'manager_keuangan', 'manager_hr', 'rnd_staff', 'marketing_kol'],
  },
  {
    id: 'production',
    name: 'Portal Produksi',
    description: 'Proses Cutting, CMT Jahit, QC terpadu, bundle tracking, penjadwalan, dan monitoring produksi.',
    icon: Factory,
    accent: 'info',
    roles: ['admin', 'owner', 'supervisor_produksi', 'admin_produksi', 'operator', 'spv_cuting', 'operator_cuting', 'rnd_staff', 'supervisor'],
  },
  {
    id: 'warehouse',
    name: 'Portal Gudang',
    description: 'Stok kain & aksesoris, penerimaan barang, put-away, opname, return & refund, dan pengiriman.',
    icon: Warehouse,
    accent: 'mint',
    roles: ['admin', 'owner', 'admin_gudang', 'spv_packing', 'tim_packing', 'admin_aksesoris', 'supervisor'],
  },
  {
    id: 'accessories',
    name: 'Portal Aksesoris',
    description: 'Manajemen master & stok aksesoris, peminjaman, request internal, opname, dan purchase request divisi aksesoris.',
    icon: Sparkles,
    accent: 'accessories',
    roles: ['admin', 'owner', 'admin_aksesoris', 'admin_gudang', 'spv_aksesoris'],
  },
  {
    id: 'finance',
    name: 'Portal Keuangan',
    description: 'AR/Hutang, invoice maklon, pembayaran CMT, HPP otomatis, akuntansi penuh, dan arus kas.',
    icon: Landmark,
    accent: 'success',
    roles: ['admin', 'owner', 'accounting', 'staff_keuangan', 'manager_keuangan'],
  },
  {
    id: 'hr',
    name: 'Portal SDM / HRIS',
    description: 'Data karyawan, absensi & shift, penggajian multi-skema, rekrutmen, onboarding, dan KPI.',
    icon: UserCog,
    accent: 'warning',
    roles: ['admin', 'owner', 'hr', 'hr_manager', 'staff_hr'],
  },
  {
    id: 'maklon',
    name: 'Portal Maklon',
    description: 'Kelola klien maklon, terima & track order produksi, HPP jasa, surat jalan, dan invoice klien.',
    icon: Package,
    accent: 'maklon',
    roles: ['admin', 'owner', 'admin_maklon', 'admin_produksi', 'supervisor_produksi', 'accounting', 'cmt_vendor'],
  },
  {
    id: 'toko',
    name: 'Portal Marketing',
    description: 'Manajemen multi-akun marketplace, performa penjualan harian (regular & live), KOL/Kreator, task management harian, dan customer service.',
    icon: ShoppingBag,
    accent: 'toko',
    roles: ['admin', 'owner', 'pic_toko', 'pic_marketing', 'staff_marketing', 'marketing_kol', 'cs_staff', 'manager_marketing'],
  },
  {
    id: 'rnd',
    name: 'Portal RnD',
    description: 'Style Master, varian produk, proses sampling, dokumentasi pola, HPP Calculator, dan analytics Research & Development.',
    icon: FlaskConical,
    accent: 'rnd',
    roles: ['admin', 'owner', 'rnd_staff', 'manager_produksi', 'supervisor_produksi'],
  },
  {
    id: 'collaboration',
    name: 'Portal Kolaborasi',
    description: 'Unified platform untuk komunikasi tim (chat, channels, DM), document management & spreadsheet, dan student-facing LMS untuk learning & development.',
    icon: MessageSquare,
    accent: 'collab',
    roles: [],
    allRoles: true,
  },
  {
    id: 'assets',
    name: 'Manajemen Aset',
    description: 'Registrasi & pelacakan aset, depresiasi otomatis, penugasan ke karyawan, pemeliharaan, dan Request Pengadaan.',
    icon: Boxes,
    accent: 'assets',
    roles: ['admin', 'owner', 'accounting', 'manager_keuangan', 'staff_keuangan'],
  },
  {
    id: 'self',
    name: 'Portal Saya',
    description: 'Lihat kehadiran dan slip gaji pribadi Anda. Tersedia untuk semua karyawan terdaftar.',
    icon: UserCircle,
    accent: 'self',
    roles: [],
    allRoles: true,
  },
];

const ACCENT_STYLES = {
  primary: { bg: 'bg-[hsl(var(--primary)/0.15)]', border: 'border-[hsl(var(--primary)/0.30)]', text: 'text-[hsl(var(--primary))]' },
  info:    { bg: 'bg-[hsl(var(--info)/0.15)]',    border: 'border-[hsl(var(--info)/0.30)]',    text: 'text-[hsl(var(--info))]' },
  mint:    { bg: 'bg-[hsl(var(--accent)/0.22)]',  border: 'border-[hsl(var(--accent)/0.35)]',  text: 'text-[hsl(var(--accent-foreground))]' },
  success: { bg: 'bg-[hsl(var(--success)/0.15)]', border: 'border-[hsl(var(--success)/0.30)]', text: 'text-[hsl(var(--success))]' },
  warning: { bg: 'bg-[hsl(var(--warning)/0.15)]', border: 'border-[hsl(var(--warning)/0.30)]', text: 'text-[hsl(var(--warning))]' },
  maklon:      { bg: 'bg-violet-500/15',              border: 'border-violet-400/30',               text: 'text-violet-400' },
  toko:        { bg: 'bg-pink-500/15',                border: 'border-pink-400/30',                 text: 'text-pink-400' },
  rnd:         { bg: 'bg-purple-500/15',              border: 'border-purple-400/30',               text: 'text-purple-400' },
  self:        { bg: 'bg-pink-500/10',                border: 'border-pink-500/30',                 text: 'text-pink-600' },
  comm:        { bg: 'bg-sky-500/15',                 border: 'border-sky-400/30',                  text: 'text-sky-500' },
  assets:      { bg: 'bg-amber-500/15',               border: 'border-amber-400/30',                text: 'text-amber-500' },
  accessories: { bg: 'bg-teal-500/15',               border: 'border-teal-400/30',                 text: 'text-teal-400' },
};

// (Portals and accent styles defined above)

export default function PortalSelector({ user, onSelectPortal, onLogout }) {
  const userRole = (user?.role || '').toLowerCase();
  const [guideOpen, setGuideOpen] = useState(false);

  const canAccess = (portal) => {
    if (portal.allRoles) return true;  // Portal Saya is for everyone
    if (['superadmin', 'admin', 'owner'].includes(userRole)) return true;
    return portal.roles.includes(userRole);
  };

  const accessiblePortals = PORTALS.filter(canAccess);

  return (
    <div className="min-h-screen bg-ambient noise-overlay" data-testid="portal-selector-page">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 sm:px-10 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(var(--primary)/0.20)] to-[hsl(var(--accent)/0.20)] border border-[hsl(var(--primary)/0.30)] flex items-center justify-center shadow-[var(--shadow-glow-blue)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20.38 3.46 16 2 12 5.5 8 2 3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>
            </svg>
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-semibold text-foreground leading-tight">CV. Dewi Aditya</div>
            <div className="text-xs text-foreground/50 leading-tight">ERP Demo — Sistem Informasi Manajemen Terpadu</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setGuideOpen(true)}
            className="text-foreground/70 hover:text-foreground hover:bg-[var(--glass-bg-hover)] gap-2"
            data-testid="portal-selector-guide-btn"
            aria-label="Buka Panduan Penggunaan"
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Panduan</span>
          </Button>
          <ThemeToggle data-testid="portal-theme-toggle-btn" />
          <Button
            variant="ghost"
            onClick={onLogout}
            className="text-foreground/60 hover:text-foreground hover:bg-[var(--glass-bg-hover)] gap-2"
            data-testid="portal-selector-logout-btn"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Keluar</span>
          </Button>
        </div>
      </div>

      <UserGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />

      {/* Main content */}
      <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-8 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-2" data-testid="portal-selector-title">
            Pilih Portal
          </h1>
          <p className="text-foreground/50 text-base mb-10">
            Selamat datang, {user?.name || 'Pengguna'}. Silakan pilih portal sesuai tugas Anda.
          </p>
        </motion.div>

        {/* Portal cards grid — uniform heights */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 auto-rows-fr">
          {PORTALS.map((portal, idx) => {
            const Icon = portal.icon;
            const hasAccess = canAccess(portal);
            const a = ACCENT_STYLES[portal.accent] || ACCENT_STYLES.primary;

            return (
              <motion.div
                key={portal.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 * idx }}
                className="h-full"
              >
                <GlassCard
                  hover={hasAccess}
                  className={`p-6 h-full min-h-[200px] flex flex-col cursor-${hasAccess ? 'pointer' : 'default'} group relative ${
                    !hasAccess ? 'opacity-50' : ''
                  }`}
                  onClick={() => hasAccess && onSelectPortal(portal.id)}
                  data-testid={`portal-selector-${portal.id}-card`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 border ${
                    hasAccess ? `${a.bg} ${a.border}` : 'bg-white/5 border-white/10'
                  }`}>
                    {hasAccess
                      ? <Icon className={`w-5 h-5 ${a.text}`} strokeWidth={2} />
                      : <Lock className="w-5 h-5 text-foreground/30" />
                    }
                  </div>

                  <h3 className="text-base font-semibold text-foreground mb-1.5" data-testid={`portal-${portal.id}-name`}>{portal.name}</h3>
                  <p className="text-sm text-foreground/55 leading-relaxed mb-4 flex-1">{portal.description}</p>

                  {hasAccess ? (
                    <div className="flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))]/80 group-hover:text-[hsl(var(--primary))] transition-colors">
                      <span>Masuk</span>
                      <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  ) : (
                    <span className="inline-flex self-start items-center text-xs font-medium text-foreground/40 bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5">
                      Tidak ada akses
                    </span>
                  )}
                </GlassCard>
              </motion.div>
            );
          })}
        </div>

        {/* Your Access */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10"
        >
          <GlassPanel className="p-5" data-testid="portal-selector-access-panel">
            <h4 className="text-sm font-semibold text-foreground/80 mb-2">Akses Anda</h4>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-foreground/50">
              <div>
                <span className="text-foreground/40">Peran: </span>
                <span className="text-foreground font-medium capitalize" data-testid="access-role">{userRole || '-'}</span>
              </div>
              <div>
                <span className="text-foreground/40">Portal dapat diakses: </span>
                <span className="text-[hsl(var(--primary))] font-medium" data-testid="access-active-count">
                  {accessiblePortals.length} dari {PORTALS.length}
                </span>
              </div>
            </div>
          </GlassPanel>
        </motion.div>
      </div>
    </div>
  );
}
