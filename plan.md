# Development Plan — Phase 6 ✅ SELESAI (1 Juni 2026)

> **Coverage auto-posting: ~73% → ~88%** — WIP Journal, Kas Kecil, Bank Transfer sudah auto-post GL.

## 1) Objectives
- Memastikan **transaksi inti pabrik garmen** tercatat langsung di sistem dan menghasilkan **jurnal otomatis** (minim jurnal manual).
- Menutup 3 gap kritikal Phase 6:
  1. **6A WIP Journal (WO GL Hooks)**: WO complete → Dr Finished Goods / Cr WIP (implemented) + retry posting.
  2. **6B Kas Kecil / Petty Cash (Imprest)**: dana kas kecil + transaksi + replenishment + closing + auto-posting GL + UI.
  3. **6C Bank Transfer Antar Rekening**: transfer internal bank-to-bank + auto-JE + void.
- Setup awal deployment kosong: **seed COA + posting profiles** agar auto-posting aktif.

**Status saat ini (Phase 6):**
- ✅ Backend: WO completion hook + retry endpoint
- ✅ Backend: Petty Cash routes + auto-posting
- ✅ Backend: Bank Transfer routes + auto-posting + void
- ✅ Frontend: PettyCashModule + BankTransferModule + menu Finance
- ✅ Frontend: Badge status WIP→FG posting + retry di WO detail
- ✅ Data: COA seeded (88 akun) + Posting profiles seeded (18 event types, termasuk petty_cash_* dan bank_transfer)
- ✅ E2E: Testing lulus (iteration_7)

---

## 2) Implementation Steps

### Phase 0 — Setup Wajib (Seed) ✅ SELESAI
**User stories**
1. Sebagai Finance, saya ingin men-seed COA agar transaksi bisa diposting ke GL.
2. Sebagai Finance, saya ingin men-seed Posting Profiles agar jurnal otomatis bisa berjalan.
3. Sebagai Admin, saya ingin memvalidasi akun COA yang dipakai mapping adalah leaf (postable).
4. Sebagai Finance, saya ingin melihat bahwa posting profiles aktif untuk event_type penting.
5. Sebagai Admin, saya ingin bisa re-run seed tanpa duplikasi (idempotent).

**Implemented**
- Jalankan seed COA via: `POST /api/rahaza/coa/seed`
- Jalankan seed Posting Profiles via: `POST /api/rahaza/posting-profiles/seed`
- Sync GL mapping EEM agar sesuai COA actual (hindari kode akun yang tidak eksis).

**Exit criteria**: ✅ COA terisi, posting profiles terisi, validasi akun postable lulus.

---

### Phase 1 — Core POC (Isolation): Auto-JE untuk 3 gap ✅ (Covered by E2E)
Fokus: buktikan 3 core flow menghasilkan JE seimbang via `_create_posted_je()` dan idempotent (source_module/source_ref).

**Implemented**
- Petty Cash: opening/replenish/expense → JE tercipta
- Bank Transfer: create → JE tercipta, retry + void tersedia
- WIP completion: WO completed → WIP→FG posting attempt + retry endpoint

**Exit criteria**: ✅ JE valid, idempotent, retry aman.

---

### Phase 2 — V1 App Development (Backend + Frontend) ✅ SELESAI

#### Phase 6A — WIP Journal (WO GL Hooks) ✅
**Implemented**
- Backend:
  - Hook di `routes/rahaza_work_orders.py` pada status `completed` untuk memanggil `post_wip_to_fg_on_wo_complete`.
  - Endpoint retry: `POST /api/rahaza/work-orders/{id}/retry-wip-posting`
  - Persist status pada WO: `wip_complete_posted`, `wip_complete_je_number`, `wip_complete_error`.
- Frontend:
  - Badge WIP posting status + tombol retry di `RahazaWorkOrdersModule.jsx`.

#### Phase 6B — Kas Kecil / Petty Cash (Imprest) ✅
**Implemented**
- Backend (`/api/finance/petty-cash`):
  - Fund: create/list/detail/replenish/close
  - Txn: create/list + retry posting
  - Auto-posting:
    - Expense/Advance: Dr expense (category→GL mapping) / Cr Kas Kecil
    - Replenish/Opening: Dr Kas Kecil / Cr Bank
- Frontend:
  - `PettyCashModule.jsx` di Finance Portal → KAS & PEMBAYARAN → Kas Kecil.

#### Phase 6C — Bank Transfer Antar Rekening ✅
**Implemented**
- Backend (`/api/finance/bank-transfers`):
  - create/list/detail
  - retry posting
  - void (buat reversal JE)
- Frontend:
  - `BankTransferModule.jsx` di Finance Portal → KAS & PEMBAYARAN → Transfer Bank.

**Phase 2 Exit**
- ✅ `testing_agent_v3` lulus (iteration_7).

---

### Phase 3 — Hardening + Reporting + Edge Cases (Phase 6) ⏳ BACKLOG
**User stories**
1. Sebagai Finance, saya ingin laporan petty cash per periode + kategori.
2. Sebagai Finance, saya ingin filter JE by source_module/source_ref.
3. Sebagai Admin, saya ingin role-based access yang jelas (cashier vs finance).
4. Sebagai Finance, saya ingin reversal/void policy yang konsisten.
5. Sebagai Auditor, saya ingin export CSV ringkas untuk petty cash & bank transfer.

**Next hardening ideas**
- Validasi periode akuntansi (period locked/closed) untuk semua posting Phase 6.
- UI error surfacing konsisten.

---

# Development Plan — Phase 7 ✅ IMPLEMENTED (Remaining GL Gaps + Auto-seed Infra)

> **Goal:** tutup 3 gap GL tersisa agar **penjualan online, retur, dan varians produksi** juga minim jurnal manual — plus infra seed untuk deployment produksi.

## 1) Objectives (Phase 7)
- ✅ Menutup gap GL P0:
  1. **Marketing Sales → AR Invoice** (batch generation + auto-posting)
  2. **Returns → Credit Note** (credit note + reversing JE)
  3. **Production Variance → GL posting** (nilai varians + JE otomatis)
- ✅ Membuat deployment produksi **out-of-the-box** melalui:
  - **auto-seed COA + Posting Profiles saat startup** (hanya jika DB masih kosong).
- ✅ Menyediakan UI operasional agar user non-teknis bisa:
  - generate AR batch
  - seed accounting setup

**Status saat ini (Phase 7):**
- ✅ Backend: endpoint batch AR dari marketing sales data + langsung set `sent` + auto-posting.
- ✅ Backend: credit note dari marketing returns + auto-post reversing JE + endpoint retry.
- ✅ Backend: endpoint posting production variance + retry + kalkulasi `variance_value` (butuh unit_cost jika tidak ada).
- ✅ Backend: auto-seed COA & posting profiles pada startup `server.py` (idempotent, cek count == 0).
- ✅ Backend: endpoint admin untuk seed manual & cek status accounting.
- ✅ Frontend: `MarketingARBridgeModule.jsx` dibuat dan diregister di module registry & sidebar Marketing.
- ✅ Frontend: `AdminSetupPanelModule.jsx` dibuat dan diregister di module registry & sidebar Finance.
- ⏳ Testing: belum dilakukan menyeluruh (backend + frontend regression).

---

## 2) Implementation Steps (Phase 7)

### Phase 7A — Marketing Sales → AR Invoice Bridge ✅
**Scope**
- Dari marketing sales data buat **batch AR invoice**.
- AR invoice langsung diset `sent` agar auto-posting `ar_invoice` berjalan.

**Backend (Implemented)**
- Endpoint baru:
  - `POST /api/marketing/sales-data/generate-ar-batch`
    - Input: `date_from`, `date_to`, `account_id?`, `platform?`, `revenue_type`, `grouping`, `notes?`, `customer_id?`
    - Proses: aggregate `marketing_sales_data` by grouping (daily/weekly/monthly/platform)
    - Output: list AR invoice created + `_posting_result`
- Customer mapping:
  - Default: auto-create/lookup customer code `MARKETPLACE` ("Marketplace Customer")

**Frontend (Implemented)**
- Modul baru: `MarketingARBridgeModule.jsx`
  - Form periode + revenue type + grouping
  - Table/list hasil invoice + indikator sukses/gagal posting
- Sidebar Marketing:
  - Menu `marketing-ar-bridge` (Marketing Sales → AR Invoice)

**Exit criteria**: ✅ Batch AR berhasil dibuat dan JE `ar_invoice` ter-generate tanpa jurnal manual.

---

### Phase 7B — Returns → Credit Note ✅
**Scope**
- Dari retur yang statusnya `approved/completed`, user dapat membuat credit note yang membalik AR/Revenue.

**Backend (Implemented)**
- Endpoint baru:
  - `POST /api/marketing/returns/{id}/create-credit-note`
  - `POST /api/marketing/returns/credit-notes/{cn_id}/post-to-gl` (retry)
  - `GET /api/marketing/returns/credit-notes` dan `GET /api/marketing/returns/credit-notes/{cn_id}`
- Collection: `rahaza_credit_notes`
- Auto-posting:
  - Fungsi baru di posting engine: `post_credit_note()`
  - Rule: **Dr Revenue / Cr AR** (menggunakan mapping event `ar_invoice` dibalik)

**Catatan**
- Return record disimpan referensi: `credit_note_id`, `credit_note_number`, `credit_note_status`

**Frontend (Status)**
- ⏳ Belum ditambahkan tombol/UX di module returns (opsi next iteration).

**Exit criteria**: ✅ Credit note tercipta dan JE reversal tercatat otomatis.

---

### Phase 7C — Production Variance → GL Auto-posting ✅
**Scope**
- Variance over/under production bisa diposting ke GL dengan nilai IDR (`variance_value`).

**Backend (Implemented)**
- Endpoint baru:
  - `POST /api/production-variances/{id}/post-gl`
  - `POST /api/production-variances/{id}/retry-posting`
- Auto-posting:
  - Fungsi baru di posting engine: `post_production_variance()`
  - Mapping event types (disupport):
    - `variance_overproduction` (fallback akun: Dr `1-1404`, Cr `5-9100`)
    - `variance_underproduction` (fallback akun: Dr `6-4100`, Cr `1-1403`)

**Catatan penting**
- Perhitungan `variance_value` saat ini:
  - mencoba lookup `sku → rahaza_products.cost_per_unit/price` (jika ada)
  - fallback: gunakan `unit_cost` dari request body
  - Jika tetap 0 → endpoint menolak posting (harus ada unit_cost).

**Frontend (Status)**
- ⏳ Belum dibuat UI khusus di variances list (opsi next iteration).

**Exit criteria**: ✅ Variance bisa dipost ke GL dengan JE seimbang dan idempotent.

---

### Phase 7D — Auto-seed on startup (Out-of-the-box deployment) ✅
**Scope**
- Deployment baru tidak boleh “blank GL” — COA + posting profiles harus siap.

**Backend (Implemented)**
- Di `server.py` startup:
  - cek `rahaza_coa_accounts.count_documents({})`
    - jika 0 → `seed_coa_accounts(db)`
  - cek `rahaza_posting_profiles.count_documents({})`
    - jika 0 → `seed_posting_profiles(db)`

**Frontend + Backend Admin Panel (Implemented)**
- Endpoint admin (superadmin):
  - `POST /api/rahaza/admin/seed-coa`
  - `POST /api/rahaza/admin/seed-posting-profiles`
  - `POST /api/rahaza/admin/seed-all-accounting`
  - `GET  /api/rahaza/admin/accounting-status`
- UI:
  - `AdminSetupPanelModule.jsx` di Finance → "Setup & Master Data"

**Exit criteria**: ✅ App baru jalan tanpa langkah manual seed + ada tombol seed untuk operasi.

---

## 3) Next Actions (Phase 7 — Finalisasi)

### 3.1 Testing & Regression (P0) ⏳ IN PROGRESS
1. Jalankan `testing_agent_v3` (backend + frontend) dengan skenario:
   - **Marketing AR Bridge**: buat sales data contoh → generate AR batch → pastikan `rahaza_ar_invoices.gl_je_id` terisi + JE balance.
   - **Credit Note**: buat return (approved) → create credit note → pastikan JE reversal terbentuk.
   - **Production Variance**: create variance → set `unit_cost` → post-gl → JE terbentuk.
   - **Auto-seed**: jalankan di DB kosong (atau simulate) → COA & posting profiles terisi.
2. Tambah test manual cepat (smoke):
   - login superadmin (`admin@garment.com` / `Admin@123`)
   - buka menu Marketing AR Bridge & Admin Setup Panel.

### 3.2 Hardening / Follow-up (P1)
- Tambahkan UI di Returns module:
  - tombol “Buat Credit Note” + badge status + link ke JE.
- Tambahkan UI di Production Variances:
  - tombol “Post GL”, input unit_cost (jika perlu), badge posted/unposted.
- Pastikan posting profile seed mencakup event types baru:
  - `variance_overproduction`, `variance_underproduction`.

---

## 4) Success Criteria
- ✅ Marketing Sales bisa menghasilkan AR invoices + JE tanpa jurnal manual.
- ✅ Return bisa membuat credit note + JE reversal tanpa jurnal manual.
- ✅ Production variance bisa dipost ke GL + audit trail.
- ✅ Deployment baru auto-seed COA + posting profiles (out-of-the-box) + tersedia Admin Setup Panel.
- ⏳ `testing_agent_v3` lulus untuk semua flow Phase 7 tanpa regression.

---

# Development Plan — Phase 8–11 ✅ Backend DONE, Frontend P0 (Auto-posting Coverage → 94%+)

> **Goal global:** menyelesaikan Phase 8–11 untuk mencapai **94%+ auto-posting coverage**, dan (kritikal) menyediakan **Frontend UI operasional** untuk semua fitur yang sudah dibangun di backend.

## 1) Objectives (Phase 8–11)
- ✅ Backend Phase 8–10 telah selesai dan diuji (iteration_8 & iteration_9) tanpa regresi mayor.
- ✅ Backend Phase 11 (Employee Loans + Scrap) **sudah implemented sepenuhnya**.
- ✅ Phase B (8 UI modules) selesai, ter-register, dan terintegrasi.
- ✅ Database Backup & Restore module production-grade sudah diimplementasi (scripts + APScheduler + UI ZIP download/upload + selective restore).
- ⏳ **P0 utama saat ini:**
  1) Menjalankan testing terstruktur Phase 7 (regression)
  2) Menjalankan testing terstruktur Phase 11 (backend validation)
  3) Menyelesaikan E2E untuk seluruh UI Phase 8–11

**Style UI yang disepakati:** konsisten dengan modul Finance yang sudah ada (card-based + Shadcn UI).

---

## 2) Implementation Steps (Phase 8–11)

### Phase A — Backend Validation (P0) ⏳ IN PROGRESS
**Tujuan:** memastikan Phase 11 (Employee Loans + Scrap) benar-benar aman, idempotent, dan mapping GL lengkap sebelum UI dibuat.

**Checklist**
1. Jalankan `testing_agent_v3` untuk skenario berikut:
   - Employee Loan Disbursement:
     - `POST /api/rahaza/hr/employee-loans/disburse`
     - Validasi: JE terbentuk dan balance, idempotent, `gl_disbursement_je_number` terisi.
   - Employee Loan Repayment via Payroll:
     - `POST /api/rahaza/hr/employee-loans/{loan_id}/deduct-from-payroll`
     - Validasi: JE terbentuk sesuai mapping (Salary Payable ↔ Loan Receivable).
   - Manual repayment:
     - `POST /api/rahaza/hr/employee-loans/{loan_id}/repay`
     - Pastikan requirement GL untuk manual repayment jelas.
   - Scrap Inventory Adjustment:
     - buat inventory adjustment dengan `adjustment_reason=scrap/waste/reject/rusak`
     - Validasi: event `inventory_scrap` → Dr Scrap Expense / Cr Inventory.

2. Validasi COA account existence:
   - `1-1320` (Piutang Pinjaman Karyawan / Employee Loan Receivable)
   - `6-4300` (Scrap Expense)

3. Validasi mapping posting profiles:
   - `employee_loan_disbursement`, `employee_loan_repayment_payroll`, `inventory_scrap`

**Exit criteria**
- ✅ Semua endpoint Phase 11 lolos testing agent.
- ✅ JE seimbang dan mapping tidak missing.

---

### Phase B — Frontend UI Build (P0) ✅ SELESAI
> Catatan: Phase B UI (Accruals, Asset Depreciation, Bad Debt Write-Off, Sales Discount, Asset Disposal, Purchase Discount, Employee Loans, Inventory Scrap) telah dibangun, dipetakan, dan diregister.

**Exit criteria**
- ✅ Semua modul Phase 8–11 muncul di sidebar dan bisa dipakai end-user.

---

### Phase C — E2E Testing (P0) ⏳ PENDING
**Tujuan:** memastikan UI → API → auto-posting berjalan end-to-end tanpa error dan tanpa regresi ke modul lama.

**Testing (gunakan `testing_agent_v3`)**
1. Smoke UI navigation:
   - semua menu baru bisa dibuka tanpa error lazy-load.
2. Phase 8:
   - Create accrual → cek JE
   - Run batch depreciation → cek JE
3. Phase 9:
   - Bad debt write-off → cek JE
   - Sales discount entry → cek JE/record
4. Phase 10:
   - Asset disposal → cek JE
   - Purchase discount → cek JE
5. Phase 11:
   - Disburse loan → cek JE
   - Repay loan manual → cek saldo & (jika required) JE
   - Payroll deduction → cek JE
   - Scrap adjustment → cek JE `inventory_scrap`

**Exit criteria**
- ✅ Tidak ada error console fatal di UI.
- ✅ Semua posting menghasilkan JE balance dan idempotent.
- ✅ Coverage auto-posting mencapai target **94%+**.

---

## 3) Next Actions (Phase 8–11 — Finalisasi)

### 3.1 P0 — Eksekusi sesuai keputusan user
1. ⏳ Jalankan **Backend validation Phase 11** dengan `testing_agent_v3`.
2. ⏳ Jalankan **E2E testing** setelah seluruh UI selesai.

### 3.2 P1 — Opsional Hardening
- Tambahkan tombol/UX Phase 7 yang belum ada:
  - Returns: “Buat Credit Note” + badge status + link ke JE.
  - Production variances: “Post GL” + input unit_cost bila perlu.
- Refactor posting engine:
  - `rahaza_posting.py` sudah >1400 baris; pecah per domain (finance/inventory/hr) setelah P0 UI selesai.

---

## 4) Success Criteria (Global)
- ✅ Backend Phase 7–11 lengkap (auto-posting engine + posting profiles + COA seed).
- ✅ Frontend tersedia untuk Phase 8/9/10/11 sehingga user bisa menjalankan proses tanpa API manual.
- ✅ `testing_agent_v3` lulus untuk backend validation Phase 11 dan E2E UI flows.
- ✅ Auto-posting coverage **94%+** dan jurnal manual hanya untuk kasus exception.

---

# Development Plan — Phase M1 (Maklon Data Separation) ⏳ NEW (Buyer Catalog + DA Product Master Rename)

> **Tujuan:** memisahkan master data **Maklon vs Internal** agar flow tidak tercampur dan tidak membingungkan user.

## 1) Objectives (Phase M1)
1. ✅ Konfirmasi arsitektur: master data **Maklon** dan **Internal** dipisah total.
2. ⏳ Menambahkan master data Maklon baru: **Buyer Catalog** (artikel dari buyer) yang sederhana dan reusable.
3. ⏳ Integrasi Buyer Catalog ke **Maklon PO** sebagai default auto-fill (tetap editable) tanpa merusak PO existing.
4. ⏳ Rename label internal master:
   - "Master Produk & BOM" → **"DA Product Master"** (label only, tidak ubah DB schema).
5. ⏳ Permission: **P1** — semua user Maklon boleh CRUD Buyer Catalog.

**Status saat ini (Phase M1):**
- ✅ Impact analysis selesai (termasuk identifikasi potensi konflik dengan Marketing Catalog).
- ✅ Keputusan user:
  - Internal master rename: **DA Product Master**
  - Maklon master baru: **Buyer Catalog**
  - Scope: Phase 1 implementasi (Backend CRUD + Frontend + Picker + Rename + Testing)
  - Permission: **P1**
- ⏳ Implementasi belum dimulai (coding belum dilakukan).

---

## 2) Implementation Steps (Phase M1)

### Phase M1.0 — Impact Analysis & Guardrails ✅ SELESAI
**Checklist (done)**
- Trace semua referensi label "Master Produk" di frontend (`portalNav.js`, `RahazaModelsAndBOMModule.jsx`, user guide, docs).
- Verifikasi `ProductsModule.jsx` adalah orphan (tidak muncul di sidebar).
- Identifikasi potensi kebingungan antara:
  - Marketing Catalog (`marketing-catalog`) vs
  - internal master (akan di-rename) vs
  - Buyer Catalog Maklon (baru).
- Trace titik integrasi Maklon PO (`dewi_maklon_pos.py` + `MaklonPOModule.jsx`).

**Guardrails**
- Tidak mengubah port/.env.
- Semua endpoint baru wajib `require_auth`.
- Perubahan bersifat additive untuk backward compatibility (PO lama tetap valid).

---

### Phase M1.1 — Backend: Buyer Catalog CRUD + Indexes ⏳ PENDING
**Tujuan:** menyediakan SSOT artikel buyer untuk Maklon.

**Backend scope**
1. Buat file baru: `backend/routes/dewi_maklon_buyer_catalog.py`
2. Collection baru: `dewi_maklon_buyer_catalog`
3. Endpoint (prefix konsisten: `/api/dewi/maklon`):
   - `GET    /buyer-catalog?client_id=&status=&search=&limit=`
   - `POST   /buyer-catalog`
   - `GET    /buyer-catalog/{id}`
   - `PUT    /buyer-catalog/{id}`
   - `PUT    /buyer-catalog/{id}/toggle` (active/inactive/discontinued atau minimal active/inactive)
   - `DELETE /buyer-catalog/{id}` (opsional; default soft-delete via status disarankan)
4. Implement schema sesuai definisi:
```json
{
  "id": "uuid",
  "client_id": "str",
  "client_name": "str",
  "artikel_code": "str",
  "buyer_ref_code": "str",
  "product_name": "str",
  "category": "str",
  "season": "str?",
  "gender": "str?",
  "default_cmt_price": 0.0,
  "default_selling_price": 0.0,
  "color_options": ["str"],
  "size_options": ["str"],
  "description": "str",
  "hero_image_url": "str?",
  "status": "active|inactive|discontinued",
  "created_at": "datetime",
  "updated_at": "datetime",
  "created_by": "str"
}
```

**Indexes (startup `server.py`)**
- `client_id`
- `status`
- `artikel_code` unique (opsional; jika unik per client → composite unique: `(client_id, artikel_code)`)
- `buyer_ref_code` (opsional; jika sering dicari)
- text index untuk search (`artikel_code`, `buyer_ref_code`, `product_name`)

**Exit criteria**
- ✅ CRUD berjalan.
- ✅ Search dan filter client/status berfungsi.
- ✅ Index aman dan idempotent.

---

### Phase M1.2 — Backend: Integrasi ke Maklon PO (Optional Link, Auto-fill) ⏳ PENDING
**Tujuan:** PO Maklon dapat mengambil default artikel + harga dari Buyer Catalog, namun tetap bisa diubah.

**Backend scope (modify `dewi_maklon_pos.py`)**
1. Tambah field opsional pada `MaklonPOItemIn`:
   - `buyer_catalog_id: Optional[str] = None`
2. Saat create/update PO:
   - Jika `buyer_catalog_id` ada → fetch dokumen Buyer Catalog
   - Auto-fill default (jika input belum diisi) / snapshot:
     - `artikel` (mis. `artikel_code` atau `buyer_ref_code` sesuai rule yang disepakati; default: tampilkan `buyer_ref_code` + simpan `artikel_code` juga bila perlu)
     - `product_description`
     - `cmt_rate_per_pcs` default = `default_cmt_price`
   - Simpan `buyer_catalog_id` di embedded item untuk traceability.
3. Backward compat:
   - PO lama tanpa `buyer_catalog_id` tetap valid.

**Exit criteria**
- ✅ PO baru bisa dibuat dengan atau tanpa `buyer_catalog_id`.
- ✅ Auto-fill tidak memaksa, tetap editable.
- ✅ Tidak ada breaking change pada list/detail endpoint PO.

---

### Phase M1.3 — Frontend: Buyer Catalog Module + Picker + Integrasi PO ⏳ PENDING
**Tujuan:** user Maklon punya UI untuk kelola Buyer Catalog dan menggunakannya di PO.

**Frontend scope**
1. Buat module baru: `MaklonBuyerCatalogModule.jsx`
   - List + filter (client/status/search)
   - Create/Edit dialog
   - Toggle status
   - Sesuaikan style dengan Maklon modules (GlassCard, PageHeader, EmptyState).
2. Buat komponen picker: `MaklonBuyerCatalogPicker.jsx`
   - Dialog pencarian 
   - pilih item → return payload ke PO form.
3. Modify `MaklonPOModule.jsx`
   - Tambah tombol per-row: **"Pilih dari Buyer Catalog"**
   - Setelah pilih:
     - set `buyer_catalog_id`
     - set `artikel` + set default `cmt_rate_per_pcs`
     - user tetap bisa edit manual.
4. Register modul:
   - `moduleRegistry.js`: tambah mapping id `maklon-buyer-catalog` → `MaklonBuyerCatalogModule`
   - `portalNav.js`: tambah menu di Portal Maklon (Master Data) label **Buyer Catalog**

**Exit criteria**
- ✅ Menu Buyer Catalog muncul di Portal Maklon.
- ✅ CRUD via UI berjalan.
- ✅ Picker dapat digunakan saat create PO.

---

### Phase M1.4 — Rename UI Label: Internal → “DA Product Master” ⏳ PENDING
**Tujuan:** konsistensi istilah dan mengurangi kebingungan antara katalog marketing vs master internal.

**Scope (label only, no ID/route change)**
- `frontend/src/components/erp/portal-shell/portalNav.js`
  - label `prod-models-bom`: "Master Produk & BOM" → "DA Product Master"
- `frontend/src/components/erp/RahazaModelsAndBOMModule.jsx`
  - header → "DA Product Master"
  - tab label "Master Model" → "DA Product Master" (atau "DA Models" jika ingin lebih ringkas)
- Update copy minor:
  - `frontend/src/components/erp/userGuide/guideData.js`
  - `/app/FORENSIC_07_INFORMATION_ARCHITECTURE.md`

**Exit criteria**
- ✅ Tidak ada perubahan module_id maupun routing.
- ✅ Tidak ada regression pada Portal Produksi.

---

### Phase M1.5 — Router Registration + Testing (Backend + Frontend) ⏳ PENDING
**Backend wiring**
- Register router baru di `backend/server.py`:
  - `from routes.dewi_maklon_buyer_catalog import router as dewi_maklon_buyer_catalog_router`
  - `app.include_router(dewi_maklon_buyer_catalog_router)`

**Testing**
1. Backend smoke (manual/curl atau testing agent):
   - CRUD Buyer Catalog
   - Create PO menggunakan `buyer_catalog_id`
   - Create PO tanpa `buyer_catalog_id`
2. Frontend smoke:
   - Navigasi menu Buyer Catalog
   - Create buyer catalog entry
   - Buat PO → pilih item via picker → pastikan auto-fill berjalan
   - Pastikan compile aman (import icon di `portalNav.js` sesuai lucide-react)

**Exit criteria**
- ✅ Tidak ada error compile/lazy-load.
- ✅ Backward compat PO lama terjaga.
- ✅ Semua perubahan sesuai guardrails.

---

## 3) Success Criteria (Phase M1)
- ✅ Master data Maklon dan internal benar-benar terpisah (tidak share collection/flow).
- ✅ Buyer Catalog bisa dipakai untuk mempercepat input PO dan mengurangi typo.
- ✅ PO tetap fleksibel: default dari catalog tapi editable.
- ✅ Penamaan konsisten:
  - Internal: **DA Product Master**
  - Maklon: **Buyer Catalog**
  - Marketing tetap: **Manajemen Katalog** (Marketplace)
- ✅ Tidak ada regression pada modul Maklon existing (Billing, Samples, QC, Tracking, PO360).
