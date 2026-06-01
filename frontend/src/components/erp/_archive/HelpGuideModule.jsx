
import { useState } from 'react';
import {
  BookOpen, ChevronDown, ChevronRight, CheckCircle, AlertCircle,
  ArrowRight, Users, Factory, ClipboardList, TrendingUp, FileText,
  CreditCard, DollarSign, BarChart3, Activity, Shirt, Package,
  Info, Star, Zap, Shield, Play, Settings, Truck, Send, ClipboardCheck,
  AlertOctagon, RotateCcw, Briefcase, FileDown, BarChart2, Layers, Hash, Tag
} from 'lucide-react';

// ─── Roles & Permissions ────────────────────────────────────────────────────────
const ROLES = [
  {
    name: 'Superadmin',
    color: 'bg-purple-100 text-purple-800 border-purple-200',
    dot: 'bg-purple-500',
    desc: 'Akses penuh ke seluruh sistem tanpa batasan',
    permissions: ['Semua modul', 'Manajemen user & role', 'Override status workflow', 'Konfigurasi sistem', 'Log aktivitas']
  },
  {
    name: 'Admin',
    color: 'bg-primary/15 text-blue-800 border-primary/20',
    dot: 'bg-primary',
    desc: 'Pengelola operasional produksi dan data master',
    permissions: ['Master data (vendor & produk)', 'Buat & kelola Production PO', 'Vendor/Buyer Shipment', 'Monitor produksi', 'Invoice & Rekap Keuangan', 'Laporan']
  },
  {
    name: 'Vendor',
    color: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
    desc: 'Vendor jahit yang mengerjakan produksi',
    permissions: ['Portal vendor khusus', 'Konfirmasi penerimaan material', 'Inspeksi material', 'Buat & kelola job produksi', 'Input progress produksi', 'Pengiriman ke buyer', 'Request material tambahan']
  },
  {
    name: 'Finance',
    color: 'bg-amber-100 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
    desc: 'Tim keuangan yang mengelola invoice dan pembayaran',
    permissions: ['Lihat & edit invoice', 'Catat pembayaran', 'Rekap keuangan', 'Laporan keuangan']
  },
  {
    name: 'Management',
    color: 'bg-secondary text-foreground border-border',
    dot: 'bg-[var(--glass-bg)]0',
    desc: 'Pimpinan yang memantau kinerja operasional',
    permissions: ['Dashboard & KPI', 'Monitoring produksi', 'Rekap keuangan', 'Semua laporan (read-only)']
  }
];

// ─── Main workflow steps ─────────────────────────────────────────────────────────
const WORKFLOW_STEPS = [
  { step: 1, title: 'Setup Master Data', icon: Shirt, color: 'bg-primary', desc: 'Daftarkan vendor garmen & buat akun vendor, lalu tambahkan data produk' },
  { step: 2, title: 'Buat Production PO', icon: ClipboardList, color: 'bg-indigo-500', desc: 'Buat pesanan produksi lengkap dengan item, serial number, dan deadline' },
  { step: 3, title: 'Kirim Material (Vendor Shipment)', icon: Truck, color: 'bg-violet-500', desc: 'ERP mengirim material ke vendor — buat Vendor Shipment dengan daftar item' },
  { step: 4, title: 'Vendor Terima & Inspeksi', icon: ClipboardCheck, color: 'bg-teal-500', desc: 'Vendor konfirmasi penerimaan material dan lakukan inspeksi kualitas material' },
  { step: 5, title: 'Buat Job Produksi', icon: Briefcase, color: 'bg-emerald-500', desc: 'Vendor buat Job Produksi dari material yang sudah diterima & diinspeksi' },
  { step: 6, title: 'Input Progress Produksi', icon: TrendingUp, color: 'bg-amber-500', desc: 'Vendor melaporkan jumlah pcs selesai per SKU/item secara berkala' },
  { step: 7, title: 'Pengiriman ke Buyer', icon: Send, color: 'bg-orange-500', desc: 'Vendor kirim produk jadi ke buyer. Bisa dikirim bertahap (dispatch)' },
  { step: 8, title: 'Invoice & Pembayaran', icon: CreditCard, color: 'bg-pink-500', desc: 'Invoice otomatis dibuat. Finance mencatat pembayaran.' },
];

// ─── Modules list for sidebar nav ────────────────────────────────────────────────
const MODULES = [
  { id: 'quickstart',         label: 'Mulai Cepat',            icon: Zap,           color: 'text-yellow-600 bg-yellow-50' },
  { id: 'login',              label: 'Login & Akun',           icon: Shield,        color: 'text-purple-600 bg-purple-50' },
  { id: 'dashboard-erp',      label: 'Dashboard ERP',          icon: BarChart3,     color: 'text-primary bg-primary/10' },
  { id: 'garments',           label: 'Data Vendor/Garmen',     icon: Shirt,         color: 'text-green-600 bg-green-50' },
  { id: 'products',           label: 'Data Produk & SKU',      icon: Package,       color: 'text-teal-600 bg-teal-50' },
  { id: 'production-po',      label: 'Production PO',          icon: ClipboardList, color: 'text-indigo-600 bg-indigo-50' },
  { id: 'po-identifier',      label: '↳ Identifier PO & SKU',  icon: Hash,          color: 'text-muted-foreground bg-[var(--glass-bg)]' },
  { id: 'vendor-shipments',   label: 'Vendor Shipment',        icon: Truck,         color: 'text-violet-600 bg-violet-50' },
  { id: 'distribusi-kerja',   label: 'Distribusi Kerja',       icon: Layers,        color: 'text-primary bg-primary/10' },
  { id: 'production-monitoring', label: 'Monitoring Produksi', icon: BarChart2,     color: 'text-cyan-600 bg-cyan-50' },
  { id: 'buyer-shipments-erp', label: 'Buyer Shipment (ERP)',  icon: Send,          color: 'text-emerald-600 bg-emerald-50' },
  { id: 'production-returns', label: 'Retur Produksi',         icon: RotateCcw,     color: 'text-red-600 bg-red-50' },
  { id: 'pdf-export',         label: 'Export PDF',             icon: FileDown,      color: 'text-muted-foreground bg-[var(--glass-bg)]' },
  { id: 'vendor-portal',      label: 'Portal Vendor',          icon: Briefcase,     color: 'text-emerald-600 bg-emerald-50' },
  { id: 'vendor-receiving',   label: '↳ Penerimaan Material',  icon: Package,       color: 'text-teal-600 bg-teal-50' },
  { id: 'vendor-inspection',  label: '↳ Inspeksi Material',    icon: ClipboardCheck, color: 'text-violet-600 bg-violet-50' },
  { id: 'vendor-jobs',        label: '↳ Job Produksi',         icon: Briefcase,     color: 'text-primary bg-primary/10' },
  { id: 'vendor-progress',    label: '↳ Progress Produksi',    icon: TrendingUp,    color: 'text-amber-600 bg-amber-50' },
  { id: 'vendor-defect',      label: '↳ Laporan Cacat',        icon: AlertOctagon,  color: 'text-red-600 bg-red-50' },
  { id: 'vendor-buyer-shipment', label: '↳ Pengiriman ke Buyer', icon: Send,        color: 'text-orange-600 bg-orange-50' },
  { id: 'invoice',            label: 'Invoice',                icon: FileText,      color: 'text-orange-600 bg-orange-50' },
  { id: 'payment',            label: 'Pembayaran',             icon: CreditCard,    color: 'text-pink-600 bg-pink-50' },
  { id: 'financial',          label: 'Rekap Keuangan',         icon: DollarSign,    color: 'text-rose-600 bg-rose-50' },
  { id: 'reports',            label: 'Laporan',                icon: BarChart3,     color: 'text-muted-foreground bg-[var(--glass-bg)]' },
  { id: 'users',              label: 'Manajemen User',         icon: Users,         color: 'text-gray-600 bg-gray-50' },
  { id: 'roles',              label: 'Role & Akses',           icon: Shield,        color: 'text-red-600 bg-red-50' },
];

// ─── Sub-components ──────────────────────────────────────────────────────────────
function StepBox({ number, title, desc }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{number}</div>
      <div>
        <p className="font-semibold text-foreground text-sm">{title}</p>
        {desc && <p className="text-muted-foreground text-sm mt-0.5">{desc}</p>}
      </div>
    </div>
  );
}

function InfoBox({ type = 'info', children }) {
  const styles = {
    info:    { bg: 'bg-primary/10 border-primary/20',    icon: 'text-primary',    text: 'text-blue-800' },
    warning: { bg: 'bg-amber-50 border-amber-200',  icon: 'text-amber-500',  text: 'text-amber-800' },
    success: { bg: 'bg-emerald-50 border-emerald-200', icon: 'text-emerald-500', text: 'text-emerald-800' },
    tip:     { bg: 'bg-purple-50 border-purple-200', icon: 'text-purple-500', text: 'text-purple-800' },
  };
  const s = styles[type];
  const Icon = type === 'warning' ? AlertCircle : type === 'success' ? CheckCircle : type === 'tip' ? Star : Info;
  return (
    <div className={`flex gap-3 p-3 rounded-lg border ${s.bg}`}>
      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${s.icon}`} />
      <p className={`text-sm ${s.text}`}>{children}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 className="font-bold text-foreground text-base mt-5 mb-2 pb-1 border-b border-border">{children}</h3>;
}

function Badge({ children, color = 'blue' }) {
  const colors = {
    blue:    'bg-primary/15 text-primary',
    green:   'bg-emerald-100 text-emerald-700',
    orange:  'bg-orange-100 text-orange-700',
    red:     'bg-red-100 text-red-700',
    purple:  'bg-purple-100 text-purple-700',
    slate:   'bg-secondary text-foreground',
    teal:    'bg-teal-100 text-teal-700',
    violet:  'bg-violet-100 text-violet-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[color] || colors.blue}`}>{children}</span>
  );
}

function FieldRow({ field, type, required, desc }) {
  return (
    <tr className="border-b border-border">
      <td className="py-2 pr-3 text-sm font-mono text-primary whitespace-nowrap">{field}</td>
      <td className="py-2 pr-3"><Badge color="slate">{type}</Badge></td>
      <td className="py-2 pr-3">{required ? <Badge color="red">Wajib</Badge> : <Badge color="green">Opsional</Badge>}</td>
      <td className="py-2 text-sm text-muted-foreground">{desc}</td>
    </tr>
  );
}

function StatusList({ items }) {
  return (
    <div className="space-y-2">
      {items.map(s => (
        <div key={s.status} className="flex items-start gap-3">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap mt-0.5 ${s.color}`}>{s.status}</span>
          <p className="text-sm text-muted-foreground">{s.desc}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Page Components ─────────────────────────────────────────────────────────────

function QuickStart() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Panduan Mulai Cepat</h2>
        <p className="text-muted-foreground text-sm">Ikuti alur kerja lengkap dari setup hingga pengiriman produk ke buyer.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {WORKFLOW_STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.step} className="relative bg-[var(--card-surface)] border border-border rounded-xl p-4 shadow-sm">
              <div className={`w-9 h-9 rounded-xl ${s.color} flex items-center justify-center mb-2`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="text-xs font-bold text-muted-foreground mb-0.5">LANGKAH {s.step}</div>
              <div className="font-semibold text-foreground text-sm">{s.title}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.desc}</div>
            </div>
          );
        })}
      </div>

      <InfoBox type="tip">
        <strong>Alur dua sisi:</strong> ERP Admin mengelola PO dan shipment material. Vendor menggunakan <strong>Portal Vendor</strong> terpisah untuk menerima, menginspeksi, memproduksi, dan mengirim barang ke buyer.
      </InfoBox>

      <SectionTitle>Langkah Detail — Sisi Admin ERP</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Login sebagai Superadmin/Admin" desc="Email: admin@garment.com | Password: Admin@123" />
        <StepBox number="2" title="Buat Data Vendor Garmen" desc="Menu: Data Vendor → Tambah Garmen. Sistem otomatis buat akun vendor (email + password)." />
        <StepBox number="3" title="Buat Data Produk dengan Varian SKU" desc="Menu: Data Produk → Tambah Produk, lengkap dengan harga CMT dan harga jual per SKU." />
        <StepBox number="4" title="Buat Production PO" desc="Menu: Production PO → Buat PO. Pilih vendor, tambah item produk (dengan Serial Number/Batch)." />
        <StepBox number="5" title="Buat Vendor Shipment (Kirim Material)" desc="Menu: Vendor Shipment → Buat Shipment. Tandai material yang dikirim ke vendor sesuai item PO." />
        <StepBox number="6" title="Pantau Progres di Monitoring Produksi" desc="Menu: Monitoring Produksi — auto-update dari aktivitas vendor portal." />
        <StepBox number="7" title="Approve Permintaan Material Tambahan" desc="Jika vendor kekurangan material, approve di Vendor Shipment → detail → tab Material Requests." />
        <StepBox number="8" title="Monitor & Kelola Buyer Shipment" desc="Menu: Buyer Shipment — lihat semua pengiriman ke buyer yang dibuat vendor." />
      </div>

      <SectionTitle>Langkah Detail — Sisi Vendor Portal</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Login dengan akun vendor" desc="Gunakan kredensial akun vendor yang diberikan admin ERP." />
        <StepBox number="2" title="Konfirmasi Penerimaan Material" desc="Menu: Penerimaan Material → Klik 'Konfirmasi Diterima' pada shipment masuk." />
        <StepBox number="3" title="Lakukan Inspeksi Material" desc="Menu: Inspeksi Material → Isi jumlah diterima, catat defect jika ada." />
        <StepBox number="4" title="Buat Job Produksi" desc="Menu: Pekerjaan Produksi → Buat Job dari shipment yang sudah diinspeksi." />
        <StepBox number="5" title="Input Progress Produksi" desc="Menu: Progress Produksi → Klik 'Input Progress' per SKU/item." />
        <StepBox number="6" title="Kirim ke Buyer" desc="Menu: Pengiriman ke Buyer → Buat pengiriman dari produk yang sudah selesai. Bisa bertahap." />
      </div>
    </div>
  );
}

function LoginGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Login & Akun</h2>
        <p className="text-muted-foreground text-sm">Cara masuk ke sistem untuk Admin ERP maupun Vendor.</p>
      </div>

      <SectionTitle>Akun Default</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
          <thead className="bg-[var(--glass-bg)]">
            <tr>
              <th className="text-left px-4 py-2 text-muted-foreground font-semibold">Email</th>
              <th className="text-left px-4 py-2 text-muted-foreground font-semibold">Password</th>
              <th className="text-left px-4 py-2 text-muted-foreground font-semibold">Role</th>
              <th className="text-left px-4 py-2 text-muted-foreground font-semibold">Tampilan</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="px-4 py-2 font-mono text-primary">admin@garment.com</td>
              <td className="px-4 py-2 font-mono">Admin@123</td>
              <td className="px-4 py-2"><Badge color="purple">Superadmin</Badge></td>
              <td className="px-4 py-2 text-xs text-muted-foreground">Dashboard ERP lengkap</td>
            </tr>
            <tr className="border-t border-border">
              <td className="px-4 py-2 font-mono text-primary">vendor.xxx@garment.com</td>
              <td className="px-4 py-2 font-mono text-muted-foreground">Auto-generate</td>
              <td className="px-4 py-2"><Badge color="green">Vendor</Badge></td>
              <td className="px-4 py-2 text-xs text-muted-foreground">Portal Vendor khusus</td>
            </tr>
          </tbody>
        </table>
      </div>

      <InfoBox type="info">
        Akun vendor dibuat <strong>otomatis</strong> saat membuat data Garmen/Vendor baru. Kredensial (email + password) ditampilkan di popup saat pembuatan — catat dan berikan ke vendor.
      </InfoBox>

      <SectionTitle>Cara Login</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka URL sistem" desc="Di browser, akses URL yang diberikan admin." />
        <StepBox number="2" title="Masukkan Email & Password" />
        <StepBox number="3" title="Klik tombol Masuk (Enter)" />
        <StepBox number="4" title="Sistem redirect otomatis" desc="Admin → Dashboard ERP. Vendor → Portal Vendor." />
      </div>

      <SectionTitle>Reset Password</SectionTitle>
      <InfoBox type="warning">
        Reset password hanya bisa dilakukan oleh <strong>Superadmin</strong>: menu Manajemen User → Edit User → isi Password baru.
      </InfoBox>
    </div>
  );
}

function DashboardGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Dashboard ERP</h2>
        <p className="text-muted-foreground text-sm">Ikhtisar real-time seluruh operasional produksi, pengiriman, dan keuangan.</p>
      </div>

      <SectionTitle>KPI Cards — Baris 1: Produksi</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {[
          { t: 'Job Aktif',         d: 'Production job yang sedang berjalan (status In Progress)' },
          { t: 'Progress Global',   d: 'Persentase total pcs diproduksi vs total pcs yang perlu diproduksi' },
          { t: 'Total Diproduksi',  d: 'Jumlah kumulatif pcs yang sudah selesai diproduksi' },
          { t: 'Pending Inspeksi',  d: 'Shipment yang sudah diterima tapi belum diinspeksi vendor' },
        ].map(c => (
          <div key={c.t} className="bg-[var(--glass-bg)] rounded-lg p-3 border border-border">
            <p className="font-semibold text-foreground text-sm">{c.t}</p>
            <p className="text-muted-foreground text-xs mt-1">{c.d}</p>
          </div>
        ))}
      </div>

      <SectionTitle>KPI Cards — Baris 2: Pengiriman & Material</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {[
          { t: 'Pending Shipment',      d: 'Vendor Shipment yang belum diterima vendor' },
          { t: 'Req. Material Tambahan', d: 'Permintaan material ADDITIONAL yang belum di-approve' },
          { t: 'Req. Penggantian',       d: 'Permintaan material REPLACEMENT yang pending' },
          { t: 'Pending Return',         d: 'Retur produksi yang masih dalam status Repair Needed' },
        ].map(c => (
          <div key={c.t} className="bg-[var(--glass-bg)] rounded-lg p-3 border border-border">
            <p className="font-semibold text-foreground text-sm">{c.t}</p>
            <p className="text-muted-foreground text-xs mt-1">{c.d}</p>
          </div>
        ))}
      </div>

      <SectionTitle>Grafik & Chart</SectionTitle>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>• <strong>Tren Produksi 6 Bulan:</strong> Bar chart jumlah PO & pcs diproduksi per bulan</p>
        <p>• <strong>Status Work Order:</strong> Pie chart distribusi status job produksi</p>
        <p>• <strong>Top Vendor by Produksi:</strong> Vendor dengan volume produksi tertinggi</p>
      </div>
    </div>
  );
}

function GarmentsGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Data Vendor/Garmen</h2>
        <p className="text-muted-foreground text-sm">Kelola data vendor jahit. Setiap vendor mendapat akun Portal Vendor otomatis.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="blue">Admin</Badge><Badge color="purple">Superadmin</Badge></div>

      <InfoBox type="success">
        Saat vendor baru dibuat, sistem <strong>otomatis membuat akun login</strong> untuk vendor tersebut. Email dan password ditampilkan di popup — berikan ke vendor agar bisa login ke Portal Vendor.
      </InfoBox>

      <SectionTitle>Menambah Vendor Baru</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka menu Data Vendor/Garmen" />
        <StepBox number="2" title="Klik tombol Tambah Garmen" />
        <StepBox number="3" title="Isi form: kode, nama, lokasi, kontak, kapasitas bulanan" />
        <StepBox number="4" title="Klik Tambah → Popup muncul dengan kredensial vendor" desc="Simpan email dan password yang tampil untuk diberikan ke vendor." />
      </div>

      <SectionTitle>Field Data Vendor</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--glass-bg)]">
            <tr>
              <th className="text-left px-3 py-2 text-muted-foreground">Field</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Tipe</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow field="garment_code" type="Text" required desc="Kode unik, contoh: GRM-001" />
            <FieldRow field="garment_name" type="Text" required desc="Nama vendor, contoh: CV. Maju Jaya" />
            <FieldRow field="location" type="Text" desc="Kota/lokasi vendor" />
            <FieldRow field="contact_person" type="Text" desc="Nama PIC vendor" />
            <FieldRow field="phone" type="Text" desc="Nomor telepon" />
            <FieldRow field="monthly_capacity" type="Angka" desc="Kapasitas produksi per bulan (pcs)" />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductsGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Data Produk & SKU</h2>
        <p className="text-muted-foreground text-sm">Kelola produk dengan varian SKU (ukuran × warna) dan harga CMT/jual per SKU.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="blue">Admin</Badge><Badge color="purple">Superadmin</Badge></div>

      <InfoBox type="info">
        Setiap <strong>varian SKU</strong> (kombinasi size + warna) memiliki kode SKU unik, harga CMT, dan harga jual. SKU ini yang dipakai saat membuat PO dan job produksi.
      </InfoBox>

      <SectionTitle>Menambah Produk & Varian</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka menu Data Produk → Tambah Produk" />
        <StepBox number="2" title="Isi kode produk, nama, kategori" />
        <StepBox number="3" title="Klik baris produk untuk expand → Tambah Varian SKU" desc="Setiap varian: pilih size, warna, isi SKU, harga CMT, harga jual." />
      </div>

      <SectionTitle>Field Varian SKU</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[var(--glass-bg)]">
            <tr>
              <th className="text-left px-3 py-2 text-muted-foreground">Field</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Tipe</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow field="sku" type="Text" required desc="Kode SKU unik, contoh: PRD-001-WHT-M" />
            <FieldRow field="size" type="Text" required desc="Ukuran: S, M, L, XL, XLL, 30, 32, dll" />
            <FieldRow field="color" type="Text" required desc="Warna: Putih, Biru, Hitam, dll" />
            <FieldRow field="cmt_price" type="Angka" desc="Biaya CMT per pcs (dibayar ke vendor)" />
            <FieldRow field="selling_price" type="Angka" desc="Harga jual ke buyer per pcs" />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductionPOGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Production PO</h2>
        <p className="text-muted-foreground text-sm">Surat Perintah Produksi yang berisi item-item yang harus diproduksi beserta Serial Number/Batch.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="blue">Admin</Badge><Badge color="purple">Superadmin</Badge></div>

      <SectionTitle>Membuat Production PO</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Menu Production PO → Klik Buat PO" />
        <StepBox number="2" title="Pilih Vendor dan Customer" />
        <StepBox number="3" title="Set Deadline Produksi & Deadline Pengiriman" />
        <StepBox number="4" title="Tambah Item" desc="Setiap item: pilih produk & SKU, isi qty, isi Serial Number/Batch (contoh: SN-2025-001). Serial digunakan sebagai penanda batch untuk tracking." />
        <StepBox number="5" title="Klik Buat PO → nomor PO auto-generate (PO0001, PO0002, dst)" />
      </div>

      <InfoBox type="tip">
        <strong>Serial Number:</strong> Nomor seri atau kode batch untuk setiap item. Digunakan untuk identifikasi dan tracking di seluruh alur — dari pengiriman material hingga pengiriman ke buyer.
      </InfoBox>

      <SectionTitle>Status PO</SectionTitle>
      <StatusList items={[
        { status: 'Draft', color: 'bg-secondary text-foreground', desc: 'PO baru dibuat, belum ada material dikirim.' },
        { status: 'Distributed', color: 'bg-primary/15 text-primary', desc: 'Vendor Shipment sudah dibuat untuk PO ini.' },
        { status: 'In Production', color: 'bg-amber-100 text-amber-700', desc: 'Vendor sudah membuat Job Produksi.' },
        { status: 'Completed', color: 'bg-emerald-100 text-emerald-700', desc: 'Semua item sudah dikirim ke buyer.' },
        { status: 'Closed', color: 'bg-secondary text-muted-foreground', desc: 'Ditutup manual oleh admin.' },
      ]} />

      <SectionTitle>Export PDF — Surat Perintah Produksi</SectionTitle>
      <StepBox number="1" title="Klik ikon mata (👁) pada PO" desc="Di modal detail, klik tombol 'Export PDF' untuk download dokumen SPP (Surat Perintah Produksi) dalam format A4." />
    </div>
  );
}

function VendorShipmentGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Vendor Shipment</h2>
        <p className="text-muted-foreground text-sm">Pengiriman material dari gudang ERP ke vendor untuk diproduksi. Mendukung 3 tipe shipment.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="blue">Admin</Badge><Badge color="purple">Superadmin</Badge></div>

      <SectionTitle>Tipe Shipment</SectionTitle>
      <div className="space-y-3">
        <div className="bg-[var(--glass-bg)] rounded-lg p-3 border">
          <div className="flex items-center gap-2 mb-1">
            <Badge color="slate">NORMAL</Badge>
            <span className="font-semibold text-sm text-foreground">Shipment Normal</span>
          </div>
          <p className="text-xs text-muted-foreground">Pengiriman material standar sesuai PO. Setelah diinspeksi vendor, bisa dibuat Job Produksi.</p>
        </div>
        <div className="bg-primary/10 rounded-lg p-3 border border-primary/20">
          <div className="flex items-center gap-2 mb-1">
            <Badge color="blue">ADDITIONAL</Badge>
            <span className="font-semibold text-sm text-foreground">Shipment Tambahan</span>
          </div>
          <p className="text-xs text-muted-foreground">Pengiriman material tambahan karena material sebelumnya kurang/hilang. Di-approve dari permintaan vendor. Otomatis membuat <strong>Child Job</strong> saat diinspeksi.</p>
        </div>
        <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
          <div className="flex items-center gap-2 mb-1">
            <Badge color="orange">REPLACEMENT</Badge>
            <span className="font-semibold text-sm text-foreground">Shipment Pengganti</span>
          </div>
          <p className="text-xs text-muted-foreground">Penggantian material cacat/defect. Di-approve dari permintaan vendor. Otomatis membuat <strong>Child Job</strong> saat diinspeksi.</p>
        </div>
      </div>

      <InfoBox type="info">
        <strong>Child Job:</strong> Saat shipment ADDITIONAL/REPLACEMENT diinspeksi, sistem otomatis membuat Production Job tambahan (child) yang terhubung ke job utama (parent). Ini memastikan total produksi tidak melebihi qty PO asli.
      </InfoBox>

      <SectionTitle>Membuat Vendor Shipment</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Menu Vendor Shipment → Buat Shipment" />
        <StepBox number="2" title="Pilih Vendor & PO, pilih Tipe (NORMAL)" />
        <StepBox number="3" title="Isi No. Surat Jalan, tanggal kirim" />
        <StepBox number="4" title="Tambah item material sesuai PO" desc="Setiap item: pilih PO Item (serial number otomatis muncul), isi qty yang dikirim." />
        <StepBox number="5" title="Klik Buat Shipment" />
      </div>

      <SectionTitle>Alur Setelah Shipment Dibuat</SectionTitle>
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <Badge color="blue">Sent</Badge>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
        <Badge color="teal">Received (vendor konfirmasi)</Badge>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
        <Badge color="green">Inspected (vendor inspeksi)</Badge>
      </div>

      <SectionTitle>Approve Permintaan Material</SectionTitle>
      <p className="text-sm text-muted-foreground">Di detail Vendor Shipment (klik 👁), lihat tab <strong>"Material Requests"</strong> untuk melihat permintaan material tambahan/penggantian dari vendor. Klik Approve untuk menyetujui dan otomatis membuat shipment baru.</p>

      <SectionTitle>Export PDF — Surat Jalan Material</SectionTitle>
      <StepBox number="1" title="Di modal detail shipment → klik 'Export PDF'" desc="Download dokumen Surat Jalan Material dalam format A4 dengan tanda tangan." />
    </div>
  );
}

function DistribusiKerjaGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Distribusi Kerja</h2>
        <p className="text-muted-foreground text-sm">Monitoring produksi hierarki 4-level: Vendor → PO → Serial Number → SKU. Mode READ-ONLY.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="blue">Admin</Badge><Badge color="purple">Superadmin</Badge><Badge color="slate">Management</Badge></div>

      <InfoBox type="warning">
        Modul ini bersifat <strong>READ-ONLY</strong> — tidak ada yang perlu diisi manual. Data auto-populate dari seluruh aktivitas produksi.
      </InfoBox>

      <SectionTitle>Tampilan Hierarki 4-Level</SectionTitle>
      <div className="bg-[var(--glass-bg)] rounded-xl border border-border p-4 space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center text-white text-xs font-bold">1</div>
          <span className="font-bold text-indigo-700">Vendor</span>
          <span className="text-muted-foreground text-xs">— Total produksi per vendor, progress bar</span>
        </div>
        <div className="flex items-center gap-2 ml-8">
          <div className="w-7 h-7 bg-primary/15 border border-primary/20 rounded-lg flex items-center justify-center text-primary text-xs font-bold">2</div>
          <span className="font-semibold text-primary">↳ PO</span>
          <span className="text-muted-foreground text-xs">— Per Production PO, deadline, customer</span>
        </div>
        <div className="flex items-center gap-2 ml-16">
          <div className="w-7 h-7 bg-amber-100 border border-amber-200 rounded-lg flex items-center justify-center text-amber-700 text-[9px] font-extrabold">SN</div>
          <span className="font-semibold text-amber-700">↳ Serial Number</span>
          <span className="text-muted-foreground text-xs">— Per batch/serial, total per seri</span>
        </div>
        <div className="flex items-center gap-2 ml-24">
          <div className="w-6 h-6 bg-[var(--card-surface)] border border-border rounded flex items-center justify-center text-muted-foreground text-[9px] font-bold">SKU</div>
          <span className="font-medium text-foreground">↳ Item SKU</span>
          <span className="text-muted-foreground text-xs">— Detail per SKU: qty ordered/received/produced/shipped + status</span>
        </div>
      </div>

      <SectionTitle>Kolom Detail Level SKU</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
          <thead className="bg-[var(--glass-bg)]">
            <tr>
              <th className="text-left px-3 py-2 text-muted-foreground">Kolom</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Penjelasan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              ['Dipesan',        'Qty dalam Production PO (target)'],
              ['Diterima',       'Qty aktual yang diterima dari kiriman ERP (pasca-inspeksi)'],
              ['Missing',        'Qty yang hilang/kurang dari kiriman (alert jika > 0)'],
              ['Cacat',          'Qty material defect dari laporan cacat vendor'],
              ['Diproduksi',     'Total qty selesai diproduksi (parent + semua child jobs)'],
              ['Sisa Prod.',     'Qty yang belum selesai diproduksi (dari qty kiriman)'],
              ['Dikirim',        'Total qty sudah dikirim ke buyer'],
              ['Status / Progress', 'Badge + progress bar (Not Started / Ongoing / Completed)'],
            ].map(([col, desc]) => (
              <tr key={col} className="hover:bg-[var(--glass-bg)]">
                <td className="px-3 py-2 font-mono text-primary text-xs whitespace-nowrap">{col}</td>
                <td className="px-3 py-2 text-muted-foreground text-sm">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SectionTitle>Status Produksi</SectionTitle>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-muted-foreground flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block"/>Belum Mulai</span>
          <p className="text-sm text-muted-foreground">produced_qty = 0</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"/>Sedang Jalan</span>
          <p className="text-sm text-muted-foreground">0 &lt; produced_qty &lt; ordered_qty</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"/>Selesai</span>
          <p className="text-sm text-muted-foreground">produced_qty ≥ ordered_qty</p>
        </div>
      </div>

      <SectionTitle>Fitur Search & Filter</SectionTitle>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>• <strong>Kotak pencarian:</strong> Ketik keyword untuk mencari</p>
        <p>• <strong>Tombol field search:</strong> Pilih cari di Semua / PO / Vendor / Serial / SKU</p>
        <p>• <strong>Dropdown vendor:</strong> Filter hanya tampilkan data satu vendor</p>
        <p>• <strong>Klik status card:</strong> Filter berdasarkan status (Belum Mulai / Ongoing / Selesai)</p>
        <p>• Saat search aktif, semua baris <strong>otomatis di-expand</strong> untuk menampilkan hasil</p>
        <p>• Tombol <strong>"Reset Filter"</strong> untuk kembali ke tampilan awal</p>
      </div>

      <SectionTitle>Expand / Collapse</SectionTitle>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>• Klik header Vendor, PO, atau Serial Number untuk expand/collapse</p>
        <p>• Tombol <strong>Expand Semua</strong> — buka semua level sekaligus</p>
        <p>• Tombol <strong>Collapse</strong> — tutup semua level</p>
      </div>
    </div>
  );
}

function MonitoringGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Monitoring Produksi</h2>
        <p className="text-muted-foreground text-sm">Pantau kinerja produksi seluruh vendor secara real-time dengan tampilan hirarki.</p>
      </div>

      <SectionTitle>Tampilan Hirarki</SectionTitle>
      <p className="text-sm text-muted-foreground">Monitoring diorganisir per vendor. Klik vendor untuk expand dan lihat detail job produksinya (parent + child jobs).</p>

      <SectionTitle>Indikator Kinerja</SectionTitle>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">On Track</span>
          <p className="text-sm text-muted-foreground">Progress ≥ 60% dari target</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">At Risk</span>
          <p className="text-sm text-muted-foreground">Progress 30–59%, deadline masih ada tapi perlu perhatian</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Overdue</span>
          <p className="text-sm text-muted-foreground">Deadline sudah lewat tapi produksi belum selesai</p>
        </div>
      </div>

      <SectionTitle>Child Jobs</SectionTitle>
      <InfoBox type="info">
        Job produksi dari shipment ADDITIONAL/REPLACEMENT (child jobs) ditampilkan di bawah job utama (parent) dengan indikasi tipe shipment. Total progress mencakup parent + semua child jobs.
      </InfoBox>
    </div>
  );
}

function BuyerShipmentERPGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Buyer Shipment (ERP View)</h2>
        <p className="text-muted-foreground text-sm">Monitor semua pengiriman ke buyer yang dibuat oleh vendor.</p>
      </div>

      <InfoBox type="info">
        Pengiriman ke buyer dibuat oleh <strong>vendor</strong> melalui Portal Vendor. Admin ERP bisa melihat dan memonitor seluruh pengiriman di modul ini.
      </InfoBox>

      <SectionTitle>Fitur Expandable Rows</SectionTitle>
      <p className="text-sm text-muted-foreground">Klik baris pengiriman untuk expand dan melihat detail item yang dikirim beserta dispatch history (jika ada beberapa kali pengiriman).</p>

      <SectionTitle>Status Pengiriman</SectionTitle>
      <StatusList items={[
        { status: 'Pending', color: 'bg-secondary text-foreground', desc: 'Belum ada item yang dikirim' },
        { status: 'Partially Shipped', color: 'bg-amber-100 text-amber-700', desc: 'Sebagian item sudah dikirim, sisanya belum' },
        { status: 'Fully Shipped', color: 'bg-emerald-100 text-emerald-700', desc: 'Semua item sudah dikirim penuh' },
      ]} />

      <SectionTitle>Export PDF — Surat Jalan Buyer</SectionTitle>
      <StepBox number="1" title="Di modal detail buyer shipment → klik 'Export PDF'" desc="Download Surat Jalan Pengiriman ke Buyer dalam format A4." />
    </div>
  );
}

function ProductionReturnGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Retur Produksi</h2>
        <p className="text-muted-foreground text-sm">Kelola pengembalian produk yang tidak memenuhi standar kualitas.</p>
      </div>

      <SectionTitle>Membuat Retur Produksi</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Menu Retur Produksi → Buat Retur" />
        <StepBox number="2" title="Pilih Production Job sumber produksi" />
        <StepBox number="3" title="Tambah item yang diretur: SKU, qty, jenis defect" />
        <StepBox number="4" title="Klik Buat Retur → nomor RTN-XXXX otomatis dibuat" />
      </div>

      <SectionTitle>Workflow Status Retur</SectionTitle>
      <StatusList items={[
        { status: 'Repair Needed', color: 'bg-red-100 text-red-700', desc: 'Retur baru dibuat, barang belum diperbaiki' },
        { status: 'In Repair', color: 'bg-amber-100 text-amber-700', desc: 'Sedang dalam proses perbaikan' },
        { status: 'Repaired', color: 'bg-primary/15 text-primary', desc: 'Sudah diperbaiki, menunggu QC' },
        { status: 'QC Passed', color: 'bg-emerald-100 text-emerald-700', desc: 'Lulus QC, bisa diship ke buyer' },
        { status: 'Scrapped', color: 'bg-secondary text-foreground', desc: 'Tidak bisa diperbaiki, dibuang/dibakar' },
      ]} />
    </div>
  );
}

function PDFExportGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Export PDF Dokumen</h2>
        <p className="text-muted-foreground text-sm">Download dokumen operasional dalam format PDF siap cetak (A4, Bahasa Indonesia).</p>
      </div>

      <SectionTitle>Dokumen yang Bisa Di-export</SectionTitle>
      <div className="space-y-3">
        {[
          { name: 'SPP — Surat Perintah Produksi', module: 'Production PO', desc: 'Header PO, info vendor/customer, daftar item dengan serial number, tanda tangan.' },
          { name: 'Surat Jalan Material', module: 'Vendor Shipment', desc: 'Detail shipment material ke vendor, tipe (Normal/Tambahan/Pengganti), daftar item, tanda tangan.' },
          { name: 'Surat Jalan Buyer', module: 'Buyer Shipment', desc: 'Detail pengiriman ke buyer, daftar produk jadi, tanda tangan.' },
          { name: 'Surat Permohonan Material', module: 'Material Request', desc: 'Detail permintaan material tambahan/pengganti dari vendor, hasil inspeksi, tanda tangan.' },
        ].map(doc => (
          <div key={doc.name} className="bg-[var(--glass-bg)] rounded-lg p-3 border border-border">
            <div className="flex items-center gap-2 mb-1">
              <FileDown className="w-4 h-4 text-muted-foreground" />
              <p className="font-semibold text-foreground text-sm">{doc.name}</p>
              <Badge color="slate">{doc.module}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{doc.desc}</p>
          </div>
        ))}
      </div>

      <SectionTitle>Cara Export PDF</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka detail dokumen" desc="Klik ikon 👁 (mata) pada baris di tabel." />
        <StepBox number="2" title="Klik tombol 'Export PDF'" desc="Tombol dengan ikon unduh di bagian atas modal detail." />
        <StepBox number="3" title="File PDF otomatis didownload" desc="Format: SPP-PO0001.pdf, SJ-Material-SHP001.pdf, dst." />
      </div>

      <SectionTitle>Format PDF</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        {[
          { t: 'Ukuran', v: 'A4 (210 × 297 mm)' },
          { t: 'Bahasa', v: 'Indonesia' },
          { t: 'Konten', v: 'Header perusahaan, tabel item, area tanda tangan, nomor halaman' },
        ].map(f => (
          <div key={f.t} className="bg-[var(--glass-bg)] rounded-lg p-3 border border-border text-center">
            <p className="font-semibold text-foreground text-xs">{f.t}</p>
            <p className="text-muted-foreground text-xs mt-1">{f.v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function VendorPortalGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Portal Vendor</h2>
        <p className="text-muted-foreground text-sm">Antarmuka khusus untuk vendor yang berbeda dari tampilan Admin ERP.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="green">Vendor</Badge></div>

      <InfoBox type="info">
        Vendor login menggunakan akun yang dibuat otomatis saat admin mendaftarkan garmen. Setelah login, vendor langsung masuk ke <strong>Portal Vendor</strong>, bukan dashboard ERP admin.
      </InfoBox>

      <SectionTitle>Modul di Portal Vendor</SectionTitle>
      <div className="space-y-2">
        {[
          { id: 'Dashboard', desc: 'KPI card: job aktif, material diterima, defect, progress global, permintaan pending.' },
          { id: 'Penerimaan Material', desc: 'Konfirmasi penerimaan material dari ERP admin.' },
          { id: 'Inspeksi Material', desc: 'Lakukan QC material: catat qty diterima, qty defect, dan ajukan permintaan material jika perlu.' },
          { id: 'Pekerjaan Produksi', desc: 'Buat dan kelola job produksi dari material yang sudah diinspeksi.' },
          { id: 'Progress Produksi', desc: 'Input kemajuan produksi per SKU/item.' },
          { id: 'Laporan Cacat Material', desc: 'Buat laporan defect material yang ditemukan.' },
          { id: 'Pengiriman ke Buyer', desc: 'Buat dan kelola pengiriman produk jadi ke buyer (bisa bertahap).' },
        ].map(m => (
          <div key={m.id} className="flex gap-3 bg-[var(--glass-bg)] rounded-lg p-3 border border-border">
            <span className="font-semibold text-emerald-700 text-sm w-44 flex-shrink-0">{m.id}</span>
            <p className="text-muted-foreground text-sm">{m.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function VendorReceivingGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Penerimaan Material (Vendor)</h2>
        <p className="text-muted-foreground text-sm">Konfirmasi penerimaan material yang dikirim dari ERP admin.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="green">Vendor</Badge></div>

      <SectionTitle>Cara Konfirmasi Penerimaan</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka menu Penerimaan Material di Portal Vendor" />
        <StepBox number="2" title="Cari shipment dengan status 'Sent'" desc="Shipment yang belum dikonfirmasi tampil di bagian atas." />
        <StepBox number="3" title="Klik 'Konfirmasi Diterima'" desc="Status shipment berubah dari Sent → Received." />
      </div>

      <InfoBox type="warning">
        Setelah dikonfirmasi diterima, <strong>wajib lakukan Inspeksi Material</strong> sebelum bisa membuat Job Produksi.
      </InfoBox>

      <SectionTitle>Info Shipment</SectionTitle>
      <p className="text-sm text-muted-foreground">Setiap shipment menampilkan: nomor shipment, tipe (Normal/Tambahan/Pengganti), tanggal kirim, daftar material, dan total qty.</p>
    </div>
  );
}

function VendorInspectionGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Inspeksi Material (Vendor)</h2>
        <p className="text-muted-foreground text-sm">QC material yang diterima sebelum produksi dimulai.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="green">Vendor</Badge></div>

      <InfoBox type="success">
        Setelah inspeksi selesai, sistem otomatis menghitung <strong>qty tersedia = qty diterima − qty defect</strong>. Job produksi dibuat berdasarkan qty tersedia ini, bukan qty PO.
      </InfoBox>

      <SectionTitle>Cara Melakukan Inspeksi</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka menu Inspeksi Material" desc="Shipment yang sudah diterima (status Received) akan muncul di sini." />
        <StepBox number="2" title="Klik tombol 'Inspeksi'" />
        <StepBox number="3" title="Isi qty diterima per item" desc="Qty aktual yang diterima (bisa berbeda dari qty yang dikirim)." />
        <StepBox number="4" title="Isi qty defect (jika ada)" desc="Material yang rusak/tidak memenuhi standar." />
        <StepBox number="5" title="Jika material kurang → Ajukan Permintaan" desc="Klik 'Request Material Tambahan' atau 'Request Penggantian' jika ada kekurangan/defect." />
        <StepBox number="6" title="Klik 'Selesai Inspeksi' → status berubah ke Inspected" />
      </div>

      <SectionTitle>Permintaan Material (Dari Inspeksi)</SectionTitle>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>• <strong>ADDITIONAL:</strong> Material yang kurang/hilang — perlu kiriman tambahan dari ERP admin</p>
        <p>• <strong>REPLACEMENT:</strong> Material cacat/defect — perlu diganti dengan yang baru</p>
      </div>

      <InfoBox type="info">
        Setelah admin ERP menyetujui permintaan, shipment baru (ADDITIONAL/REPLACEMENT) otomatis dibuat. Vendor perlu menerima dan menginspeksi shipment baru ini juga.
      </InfoBox>
    </div>
  );
}

function VendorJobsGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Pekerjaan Produksi (Vendor)</h2>
        <p className="text-muted-foreground text-sm">Buat dan kelola Production Job dari material yang sudah diterima dan diinspeksi.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="green">Vendor</Badge></div>

      <SectionTitle>Cara Membuat Job Produksi</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka menu Pekerjaan Produksi → Buat Job Produksi" />
        <StepBox number="2" title="Cari & Pilih Shipment" desc="Gunakan kotak pencarian di atas dropdown. Pilih dari kategori: Normal, Tambahan (Additional), atau Pengganti (Replacement)." />
        <StepBox number="3" title="Preview item muncul otomatis" desc="Daftar item beserta qty tersedia (hasil inspeksi) ditampilkan — terkunci, tidak bisa diubah." />
        <StepBox number="4" title="Tambahkan catatan (opsional)" />
        <StepBox number="5" title="Klik Buat Job Produksi" />
      </div>

      <InfoBox type="warning">
        Qty job produksi = <strong>qty yang diterima & diinspeksi</strong>, BUKAN qty PO. Jika material yang diterima kurang, maka qty job juga lebih sedikit.
      </InfoBox>

      <SectionTitle>Hirarki Parent-Child Job</SectionTitle>
      <div className="bg-[var(--glass-bg)] rounded-lg p-4 border border-border">
        <div className="text-sm space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary">JOB-0001 (Parent)</span>
            <Badge color="slate">NORMAL</Badge>
            <span className="text-muted-foreground text-xs">→ dibuat dari shipment normal</span>
          </div>
          <div className="ml-6 pl-3 border-l-2 border-purple-300 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-purple-700">JOB-0002 (Child)</span>
              <Badge color="blue">ADDITIONAL</Badge>
              <span className="text-muted-foreground text-xs">→ auto-dibuat dari shipment tambahan</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-purple-700">JOB-0003 (Child)</span>
              <Badge color="orange">REPLACEMENT</Badge>
              <span className="text-muted-foreground text-xs">→ auto-dibuat dari shipment pengganti</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VendorProgressGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Progress Produksi (Vendor)</h2>
        <p className="text-muted-foreground text-sm">Laporkan kemajuan produksi per item/SKU dari job produksi yang aktif.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="green">Vendor</Badge></div>

      <SectionTitle>Cara Input Progress</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka menu Progress Produksi" desc="Pilih job produksi dari dropdown." />
        <StepBox number="2" title="Daftar item/SKU ditampilkan dengan qty tersedia" />
        <StepBox number="3" title="Klik tombol 'Input Progress' pada item yang ingin dilaporkan" />
        <StepBox number="4" title="Isi tanggal progress dan jumlah pcs selesai hari ini" desc="Sistem validasi: qty input ≤ sisa yang belum diproduksi." />
        <StepBox number="5" title="Klik Simpan → progress terakumulasi" />
      </div>

      <InfoBox type="tip">
        Progress bisa diinput <strong>berkali-kali</strong>. Misalnya: hari ini selesai 100 pcs, besok selesai lagi 150 pcs. Sistem menjumlahkan secara otomatis.
      </InfoBox>

      <SectionTitle>Progress Job Selesai</SectionTitle>
      <p className="text-sm text-muted-foreground">Ketika semua item dalam sebuah job sudah diproduksi penuh (produced_qty = available_qty), status job otomatis berubah menjadi <Badge color="green">Completed</Badge>.</p>
    </div>
  );
}

function VendorDefectGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Laporan Cacat Material (Vendor)</h2>
        <p className="text-muted-foreground text-sm">Buat laporan jika ditemukan defect pada material yang sudah diterima.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="green">Vendor</Badge></div>

      <SectionTitle>Cara Membuat Laporan Cacat</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Menu Laporan Cacat Material → Buat Laporan" />
        <StepBox number="2" title="Isi SKU, nama material, qty yang cacat" />
        <StepBox number="3" title="Pilih jenis defect" desc="Contoh: Material Cacat, Warna Salah, Ukuran Tidak Sesuai, Kotor/Noda." />
        <StepBox number="4" title="Tambahkan deskripsi detail & foto (opsional)" />
        <StepBox number="5" title="Klik Buat Laporan" />
      </div>

      <InfoBox type="info">
        Laporan Cacat berbeda dari Permintaan Penggantian di Inspeksi. Laporan ini untuk <strong>dokumentasi</strong>. Untuk meminta penggantian material, gunakan fitur Request di menu Inspeksi Material.
      </InfoBox>
    </div>
  );
}

function VendorBuyerShipmentGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Pengiriman ke Buyer (Vendor)</h2>
        <p className="text-muted-foreground text-sm">Kirim produk jadi ke buyer dari job produksi yang sudah selesai. Mendukung pengiriman bertahap (dispatch).</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="green">Vendor</Badge></div>

      <SectionTitle>Cara Membuat Pengiriman</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Menu Pengiriman ke Buyer → Buat Pengiriman" />
        <StepBox number="2" title="Cari & Pilih Job Produksi" desc="Kotak pencarian di atas dropdown. Hanya job dengan sisa kirim > 0 yang tampil di grup 'Ada Sisa Kirim'. Bisa klik 'Tampilkan semua job' untuk lihat semua." />
        <StepBox number="3" title="Tabel item muncul otomatis" desc="Menampilkan: qty dipesan, qty diproduksi (parent+child), sudah dikirim, sisa kirim." />
        <StepBox number="4" title="Isi qty yang dikirim sekarang per item" desc="Tidak boleh melebihi sisa kirim." />
        <StepBox number="5" title="Klik Kirim" />
      </div>

      <SectionTitle>Sistem Dispatch (Pengiriman Bertahap)</SectionTitle>
      <InfoBox type="tip">
        Satu job produksi bisa dikirim <strong>berkali-kali</strong>. Misalnya: 100 pcs selesai → kirim 50 pcs dulu (Dispatch #1), lalu kirim 50 pcs lagi (Dispatch #2). Sistem mencatat setiap dispatch secara terpisah.
      </InfoBox>

      <SectionTitle>Menambah Dispatch Lanjutan</SectionTitle>
      <StepBox number="1" title="Klik tombol 'Dispatch' pada pengiriman yang sudah ada" desc="Modal akan terbuka dengan job yang sama, isi qty sisa yang belum dikirim." />

      <SectionTitle>Dropdown Kategorisasi Job</SectionTitle>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>• <strong>✅ Ada Sisa Kirim:</strong> Job dengan produksi tersedia untuk dikirim (default tampil)</p>
        <p>• <strong>⏳ Belum Ada Produksi:</strong> Job belum ada progress produksi sama sekali</p>
        <p>• <strong>🏁 Sudah Fully Shipped:</strong> Job sudah dikirim semua (klik 'Tampilkan semua job')</p>
      </div>
    </div>
  );
}

function InvoiceGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Manajemen Invoice</h2>
        <p className="text-muted-foreground text-sm">Invoice dibuat otomatis oleh sistem. Ada dua jenis: invoice vendor (AP) dan invoice buyer (AR).</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="blue">Admin</Badge><Badge color="purple">Superadmin</Badge><Badge color="orange">Finance</Badge></div>

      <SectionTitle>Jenis Invoice</SectionTitle>
      <div className="space-y-2">
        <div className="bg-primary/10 rounded-lg p-3 border border-primary/20">
          <div className="flex items-center gap-2 mb-1"><Badge color="blue">VENDOR (VINV)</Badge></div>
          <p className="text-xs text-muted-foreground">Invoice yang harus dibayar ERP ke vendor. Nilai = Qty × CMT Price. Auto-dibuat saat PO dikonfirmasi.</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
          <div className="flex items-center gap-2 mb-1"><Badge color="green">BUYER (BINV)</Badge></div>
          <p className="text-xs text-muted-foreground">Invoice yang harus dibayar buyer ke ERP. Nilai = Qty × Selling Price. Auto-dibuat saat PO dikonfirmasi.</p>
        </div>
        <div className="bg-[var(--glass-bg)] rounded-lg p-3 border border-border">
          <div className="flex items-center gap-2 mb-1"><Badge color="slate">MANUAL (MVINV/MBINV)</Badge></div>
          <p className="text-xs text-muted-foreground">Invoice yang dibuat manual oleh Finance. Bisa untuk koreksi atau invoice di luar alur normal.</p>
        </div>
      </div>

      <SectionTitle>Status Invoice</SectionTitle>
      <StatusList items={[
        { status: 'Draft', color: 'bg-secondary text-foreground', desc: 'Invoice baru dibuat, belum diterbitkan' },
        { status: 'Unpaid', color: 'bg-red-100 text-red-700', desc: 'Diterbitkan, belum ada pembayaran' },
        { status: 'Partial', color: 'bg-amber-100 text-amber-700', desc: 'Sudah dibayar sebagian' },
        { status: 'Paid', color: 'bg-emerald-100 text-emerald-700', desc: 'Lunas' },
        { status: 'Superseded', color: 'bg-secondary text-muted-foreground', desc: 'Digantikan oleh revisi invoice' },
      ]} />

      <SectionTitle>Revisi Invoice</SectionTitle>
      <StepBox number="1" title="Di detail invoice → klik 'Revisi Invoice'" desc="Invoice baru dibuat dengan format ORIGINAL-R1. Invoice lama diset Superseded." />
    </div>
  );
}

function PaymentGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Manajemen Pembayaran</h2>
        <p className="text-muted-foreground text-sm">Catat pembayaran ke vendor (AP) atau dari buyer (AR). Mendukung cicilan.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="blue">Admin</Badge><Badge color="purple">Superadmin</Badge><Badge color="orange">Finance</Badge></div>

      <SectionTitle>Tipe Pembayaran</SectionTitle>
      <div className="space-y-2">
        <div className="bg-red-50 rounded-lg p-3 border border-red-200">
          <Badge color="red">VENDOR_PAYMENT (Cash Out)</Badge>
          <p className="text-xs text-muted-foreground mt-1">Pembayaran ERP ke vendor. Tercatat sebagai pengeluaran kas.</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
          <Badge color="green">CUSTOMER_PAYMENT (Cash In)</Badge>
          <p className="text-xs text-muted-foreground mt-1">Penerimaan pembayaran dari buyer/customer. Tercatat sebagai penerimaan kas.</p>
        </div>
      </div>

      <SectionTitle>Mencatat Pembayaran</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Menu Hutang Vendor (AP) atau Piutang Buyer (AR)" />
        <StepBox number="2" title="Klik Catat Pembayaran" />
        <StepBox number="3" title="Pilih invoice → info sisa tagihan otomatis muncul" />
        <StepBox number="4" title="Isi jumlah bayar, tanggal, metode, no. referensi" />
        <StepBox number="5" title="Klik Simpan → status invoice update otomatis" />
      </div>
    </div>
  );
}

function FinancialGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Rekap Keuangan</h2>
        <p className="text-muted-foreground text-sm">Ringkasan finansial komprehensif: penjualan, biaya vendor, margin, AR/AP.</p>
      </div>

      <SectionTitle>Metrik Utama</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {[
          { t: 'Total Nilai Penjualan', d: 'Sum semua Buyer Invoice (BINV) yang aktif' },
          { t: 'Total Biaya Vendor',    d: 'Sum semua Vendor Invoice (VINV) yang aktif' },
          { t: 'Gross Margin',          d: 'Nilai Penjualan − Biaya Vendor' },
          { t: 'Total Cash In',         d: 'Sum semua CUSTOMER_PAYMENT yang diterima' },
          { t: 'Total Cash Out',        d: 'Sum semua VENDOR_PAYMENT yang dikeluarkan' },
          { t: 'AR Outstanding',        d: 'Piutang buyer yang belum dibayar' },
          { t: 'AP Outstanding',        d: 'Hutang ke vendor yang belum dibayar' },
        ].map(m => (
          <div key={m.t} className="bg-[var(--glass-bg)] rounded-lg p-3 border border-border">
            <p className="font-semibold text-foreground text-sm">{m.t}</p>
            <p className="text-muted-foreground text-xs mt-1">{m.d}</p>
          </div>
        ))}
      </div>

      <SectionTitle>Filter Tanggal</SectionTitle>
      <p className="text-sm text-muted-foreground">Gunakan filter date_from dan date_to di bagian atas untuk melihat rekap periode tertentu.</p>
    </div>
  );
}

function ReportsGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Laporan</h2>
        <p className="text-muted-foreground text-sm">Laporan operasional dan finansial yang dapat diexport ke CSV.</p>
      </div>

      <SectionTitle>Jenis Laporan</SectionTitle>
      {[
        { name: 'Laporan Produksi',     icon: '📋', desc: 'Semua Production PO + status, vendor, qty, deadline' },
        { name: 'Laporan Progres',      icon: '📈', desc: 'Riwayat input progress produksi per SKU/item' },
        { name: 'Laporan Invoice',      icon: '🧾', desc: 'Semua invoice (vendor + buyer) + status pembayaran' },
        { name: 'Laporan Pembayaran',   icon: '💰', desc: 'Riwayat semua transaksi pembayaran masuk/keluar' },
        { name: 'Performa Vendor',      icon: '🏭', desc: 'Kinerja setiap vendor: total job, progress%, ketepatan waktu' },
      ].map(r => (
        <div key={r.name} className="bg-[var(--glass-bg)] rounded-lg p-3 border border-border">
          <div className="flex items-center gap-2 mb-1">
            <span>{r.icon}</span>
            <p className="font-semibold text-foreground text-sm">{r.name}</p>
          </div>
          <p className="text-muted-foreground text-xs">{r.desc}</p>
        </div>
      ))}

      <SectionTitle>Export ke CSV</SectionTitle>
      <div className="space-y-2">
        <StepBox number="1" title="Pilih jenis laporan" />
        <StepBox number="2" title="Klik tombol Export CSV → file .csv didownload" />
      </div>
    </div>
  );
}

function UsersGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Manajemen User</h2>
        <p className="text-muted-foreground text-sm">Kelola akun pengguna sistem. Hanya Superadmin yang bisa mengakses.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Badge color="purple">Superadmin saja</Badge></div>

      <SectionTitle>Menambah User Baru</SectionTitle>
      <div className="space-y-3">
        <StepBox number="1" title="Buka menu Manajemen User → Tambah User" />
        <StepBox number="2" title="Isi nama lengkap & email (harus unik)" />
        <StepBox number="3" title="Set password (default: User@123 jika dikosongkan)" />
        <StepBox number="4" title="Pilih role: Admin, Finance, Management" />
        <StepBox number="5" title="Klik Tambah User" />
      </div>

      <InfoBox type="warning">
        Akun vendor dibuat <strong>otomatis</strong> dari menu Data Vendor — tidak perlu dibuat manual di sini.
      </InfoBox>
    </div>
  );
}

function RolesGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Role & Hak Akses</h2>
        <p className="text-muted-foreground text-sm">Sistem menggunakan RBAC (Role Based Access Control).</p>
      </div>

      <div className="space-y-4">
        {ROLES.map(role => (
          <div key={role.name} className="rounded-xl border p-4 bg-[var(--card-surface)]">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-3 h-3 rounded-full ${role.dot}`}></div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${role.color}`}>{role.name}</span>
              <p className="text-sm text-muted-foreground">{role.desc}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {role.permissions.map(p => (
                <span key={p} className="flex items-center gap-1 text-xs text-muted-foreground bg-[var(--glass-bg)] border border-border rounded px-2 py-0.5">
                  <CheckCircle className="w-3 h-3 text-emerald-500" />
                  {p}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>Akses per Modul</SectionTitle>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-border rounded-lg overflow-hidden">
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="text-left px-3 py-2">Modul</th>
              <th className="text-center px-2 py-2">SA</th>
              <th className="text-center px-2 py-2">Admin</th>
              <th className="text-center px-2 py-2">Vendor</th>
              <th className="text-center px-2 py-2">Finance</th>
              <th className="text-center px-2 py-2">Mgmt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[
              ['Dashboard ERP',       '✅', '✅', '❌', '✅', '✅'],
              ['Dashboard Vendor',    '❌', '❌', '✅', '❌', '❌'],
              ['Data Vendor/Garmen',  '✅', '✅', '❌', '❌', '❌'],
              ['Data Produk',         '✅', '✅', '❌', '❌', '❌'],
              ['Production PO',       '✅', '✅', '❌', '❌', '❌'],
              ['Vendor Shipment',     '✅', '✅', '❌', '❌', '❌'],
              ['Penerimaan Material', '❌', '❌', '✅', '❌', '❌'],
              ['Inspeksi Material',   '❌', '❌', '✅', '❌', '❌'],
              ['Job Produksi',        '❌', '❌', '✅', '❌', '❌'],
              ['Progress Produksi',   '❌', '❌', '✅', '❌', '❌'],
              ['Distribusi Kerja',    '✅', '✅', '❌', '❌', '✅'],
              ['Monitoring Produksi', '✅', '✅', '❌', '❌', '✅'],
              ['Buyer Shipment',      '✅', '✅', '✅', '❌', '❌'],
              ['Retur Produksi',      '✅', '✅', '❌', '❌', '❌'],
              ['Invoice',             '✅', '✅', '❌', '✅', '❌'],
              ['Pembayaran',          '✅', '✅', '❌', '✅', '❌'],
              ['Rekap Keuangan',      '✅', '✅', '❌', '✅', '✅'],
              ['Laporan',             '✅', '✅', '❌', '✅', '✅'],
              ['Manajemen User',      '✅', '❌', '❌', '❌', '❌'],
              ['Log Aktivitas',       '✅', '✅', '❌', '❌', '❌'],
            ].map(([mod, ...access]) => (
              <tr key={mod} className="hover:bg-[var(--glass-bg)]">
                <td className="px-3 py-2 font-medium text-foreground">{mod}</td>
                {access.map((a, i) => (
                  <td key={i} className="text-center px-2 py-2">{a}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground mt-1">SA = Superadmin &nbsp;|&nbsp; Mgmt = Management</p>
      </div>
    </div>
  );
}

function POIdentifierGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground mb-1">Identifier PO & SKU</h2>
        <p className="text-muted-foreground text-sm">Aturan identifier unik untuk Production PO dan varian produk (SKU).</p>
      </div>

      <SectionTitle>Aturan No. PO</SectionTitle>
      <InfoBox type="success">
        <strong>No. PO boleh duplikat.</strong> Sistem tidak memblokir pembuatan PO dengan nomor yang sama. Identifier unik PO adalah kombinasi: <strong>No. PO + Nama Vendor + Tanggal PO</strong>.
      </InfoBox>

      <div className="bg-[var(--glass-bg)] rounded-xl border border-border p-4">
        <p className="text-sm font-semibold text-foreground mb-3">Contoh: PO dengan nomor sama, vendor berbeda:</p>
        <div className="space-y-2">
          {[
            { po: 'PO-2025-001', vendor: 'CV. Maju Jaya',    date: '01 Jan 2025' },
            { po: 'PO-2025-001', vendor: 'PT. Karya Indah',  date: '01 Jan 2025' },
            { po: 'PO-2025-001', vendor: 'CV. Maju Jaya',    date: '15 Mar 2025' },
          ].map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm bg-[var(--card-surface)] rounded-lg px-3 py-2 border border-border">
              <span className="font-bold text-primary w-32">{r.po}</span>
              <span className="text-muted-foreground">+</span>
              <span className="text-purple-700 w-32">{r.vendor}</span>
              <span className="text-muted-foreground">+</span>
              <span className="text-muted-foreground">{r.date}</span>
              <span className="ml-auto text-xs text-emerald-600 font-medium">✓ Identik unik</span>
            </div>
          ))}
        </div>
      </div>

      <InfoBox type="tip">
        Di tabel Production PO, kolom pertama menampilkan: <strong>No. PO</strong> (besar) + <strong>Nama Vendor · Tanggal PO</strong> (kecil) sebagai sub-info untuk membantu identifikasi ketika ada duplikat nomor.
      </InfoBox>

      <SectionTitle>Aturan SKU</SectionTitle>
      <InfoBox type="success">
        <strong>SKU boleh duplikat</strong> di antara produk atau vendor yang berbeda. Sistem tidak memblokir pembuatan varian dengan kode SKU yang sama.
      </InfoBox>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-amber-800 mb-2">⚠️ Catatan Penting</p>
        <p className="text-sm text-amber-700">
          Meskipun SKU boleh duplikat di sistem, <strong>pastikan tim memiliki konvensi penamaan SKU yang konsisten</strong> secara internal untuk menghindari kebingungan operasional. Contoh: <code className="bg-amber-100 px-1 rounded">PRD-001-WHT-M</code> = Produk 001, Putih, Medium.
        </p>
      </div>
    </div>
  );
}

// ─── Content renderer ────────────────────────────────────────────────────────────
function renderContent(id) {
  switch (id) {
    case 'quickstart':            return <QuickStart />;
    case 'login':                 return <LoginGuide />;
    case 'dashboard-erp':         return <DashboardGuide />;
    case 'garments':              return <GarmentsGuide />;
    case 'products':              return <ProductsGuide />;
    case 'production-po':         return <ProductionPOGuide />;
    case 'po-identifier':         return <POIdentifierGuide />;
    case 'vendor-shipments':      return <VendorShipmentGuide />;
    case 'distribusi-kerja':      return <DistribusiKerjaGuide />;
    case 'production-monitoring': return <MonitoringGuide />;
    case 'buyer-shipments-erp':   return <BuyerShipmentERPGuide />;
    case 'production-returns':    return <ProductionReturnGuide />;
    case 'pdf-export':            return <PDFExportGuide />;
    case 'vendor-portal':         return <VendorPortalGuide />;
    case 'vendor-receiving':      return <VendorReceivingGuide />;
    case 'vendor-inspection':     return <VendorInspectionGuide />;
    case 'vendor-jobs':           return <VendorJobsGuide />;
    case 'vendor-progress':       return <VendorProgressGuide />;
    case 'vendor-defect':         return <VendorDefectGuide />;
    case 'vendor-buyer-shipment': return <VendorBuyerShipmentGuide />;
    case 'invoice':               return <InvoiceGuide />;
    case 'payment':               return <PaymentGuide />;
    case 'financial':             return <FinancialGuide />;
    case 'reports':               return <ReportsGuide />;
    case 'users':                 return <UsersGuide />;
    case 'roles':                 return <RolesGuide />;
    default:                      return <QuickStart />;
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────────
export default function HelpGuideModule() {
  const [activeModule, setActiveModule] = useState('quickstart');
  const [search, setSearch] = useState('');

  const filtered = search
    ? MODULES.filter(m => m.label.toLowerCase().includes(search.toLowerCase()))
    : MODULES;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Panduan Penggunaan</h1>
          <p className="text-muted-foreground text-sm">Dokumentasi lengkap Garment Production Management System — Versi 2.0</p>
        </div>
      </div>

      <div className="flex gap-5">
        {/* Sidebar nav */}
        <aside className="w-56 flex-shrink-0">
          <div className="bg-[var(--card-surface)] rounded-xl border border-border shadow-sm overflow-hidden sticky top-4">
            <div className="px-3 py-2 bg-[var(--glass-bg)] border-b border-border">
              <input
                type="text"
                placeholder="Cari topik..."
                className="w-full text-xs border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <nav className="py-1 max-h-[calc(100vh-200px)] overflow-y-auto">
              {filtered.map(m => {
                const Icon = m.icon;
                const isActive = activeModule === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => { setActiveModule(m.id); setSearch(''); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left ${
                      isActive
                        ? 'bg-primary/10 text-primary font-semibold border-r-2 border-blue-600'
                        : 'text-muted-foreground hover:bg-[var(--glass-bg)] hover:text-foreground'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-primary/15' : m.color}`}>
                      <Icon className="w-3 h-3" />
                    </div>
                    <span className="leading-tight">{m.label}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-3 py-3 text-xs text-muted-foreground text-center">Tidak ditemukan</p>
              )}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="bg-[var(--card-surface)] rounded-xl border border-border shadow-sm p-6">
            {renderContent(activeModule)}
          </div>

          {/* Navigation buttons */}
          <div className="flex justify-between mt-4">
            {(() => {
              const idx = MODULES.findIndex(m => m.id === activeModule);
              const prev = MODULES[idx - 1];
              const next = MODULES[idx + 1];
              return (
                <>
                  {prev ? (
                    <button onClick={() => setActiveModule(prev.id)}
                      className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-[var(--glass-bg)]">
                      ← {prev.label}
                    </button>
                  ) : <div />}
                  {next ? (
                    <button onClick={() => setActiveModule(next.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:brightness-110">
                      {next.label} →
                    </button>
                  ) : <div />}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
