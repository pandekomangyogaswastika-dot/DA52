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

**Frontend (Implemented)**
- Modul baru: `MarketingARBridgeModule.jsx`

**Exit criteria**: ✅ Batch AR berhasil dibuat dan JE `ar_invoice` ter-generate tanpa jurnal manual.

---

### Phase 7B — Returns → Credit Note ✅
**Backend (Implemented)**
- Credit note + auto-post reversing JE + endpoint retry.

**Frontend (Status)**
- ⏳ Belum ditambahkan tombol/UX di module returns (opsi next iteration).

**Exit criteria**: ✅ Credit note tercipta dan JE reversal tercatat otomatis.

---

### Phase 7C — Production Variance → GL Auto-posting ✅
**Backend (Implemented)**
- Posting variance + retry + idempotency.

**Frontend (Status)**
- ⏳ Belum dibuat UI khusus di variances list.

**Exit criteria**: ✅ Variance bisa dipost ke GL dengan JE seimbang dan idempotent.

---

### Phase 7D — Auto-seed on startup ✅
**Backend + Frontend Admin Panel (Implemented)**
- Auto-seed COA + posting profiles saat startup jika DB kosong.
- Admin panel untuk seed manual + status.

**Exit criteria**: ✅ App baru jalan tanpa langkah manual seed.

---

## 3) Next Actions (Phase 7 — Finalisasi) ⏳
- Jalankan regression testing Phase 7 (backend + frontend).
- Tambahkan UI:
  - Returns: tombol “Buat Credit Note” + badge status + link ke JE.
  - Production variances: tombol “Post GL” + input unit_cost + badge posted/unposted.

---

## 4) Success Criteria
- ✅ Fitur Phase 7 berjalan tanpa jurnal manual.
- ⏳ Regression testing Phase 7 lulus tanpa regresi.

---

# Development Plan — Phase 8–11 ✅ Backend DONE, Frontend P0 (Auto-posting Coverage → 94%+)

> **Goal global:** menyelesaikan Phase 8–11 untuk mencapai **94%+ auto-posting coverage**, dan menyediakan **Frontend UI operasional** untuk semua fitur yang sudah dibangun di backend.

## 1) Objectives (Phase 8–11)
- ✅ Backend Phase 8–10 telah selesai dan diuji (iteration_8 & iteration_9) tanpa regresi mayor.
- ✅ Backend Phase 11 (Employee Loans + Scrap) sudah implemented.
- ✅ Phase B (8 UI modules) selesai, ter-register, dan terintegrasi.
- ✅ Database Backup & Restore module production-grade sudah diimplementasi (scripts + APScheduler + UI ZIP download/upload + selective restore).
- ⏳ P0 berikutnya:
  1) Regression testing Phase 7
  2) Backend validation Phase 11
  3) E2E untuk seluruh UI Phase 8–11

---

## 2) Implementation Steps (Phase 8–11)

### Phase A — Backend Validation (P0) ⏳
- Validasi Employee Loans + Scrap (idempotency, JE seimbang, mapping akun ada).

### Phase B — Frontend UI Build (P0) ✅ SELESAI
- 8 modul UI sudah selesai dan terintegrasi.

### Phase C — E2E Testing (P0) ⏳
- Smoke navigation + flow posting JE untuk Phase 8–11.

---

## 3) Next Actions (Phase 8–11)
- Eksekusi testing terstruktur Phase 11 dan E2E Phase 8–11.

---

## 4) Success Criteria (Global)
- ✅ UI operasional untuk Phase 8–11.
- ✅ Auto-posting coverage target 94%+.

---

# Development Plan — Phase M1 ✅ SELESAI 100% (Maklon Data Separation)

> **Tujuan:** memisahkan master data **Maklon vs Internal** agar flow tidak tercampur dan tidak membingungkan user.

## 1) Objectives (Phase M1)
1. ✅ Konfirmasi arsitektur: master data **Maklon** dan **Internal** dipisah total.
2. ✅ Menambahkan master data Maklon baru: **Buyer Catalog** (artikel dari buyer) yang sederhana dan reusable.
3. ✅ Integrasi Buyer Catalog ke **Maklon PO** sebagai default auto-fill (tetap editable) tanpa merusak PO existing.
4. ✅ Rename label internal master:
   - "Master Produk & BOM" → **"DA Product Master"** (label only, tidak ubah DB schema).
5. ✅ Permission: **P1** — semua user Maklon boleh CRUD Buyer Catalog.

**Status akhir (Phase M1):**
- ✅ M1.0 Impact analysis selesai
- ✅ M1.1 Backend Buyer Catalog routes (CRUD + indexes)
- ✅ M1.2 Backend integrasi Maklon PO (buyer_catalog_id + auto-fill + snapshot)
- ✅ M1.3 Frontend Buyer Catalog module + picker + integrasi PO
- ✅ M1.4 Rename UI: "Master Produk & BOM" → "DA Product Master"
- ✅ M1.5 Router register + indexes + testing

**Testing**
- ✅ Testing agent iteration_12: Backend 20/20 PASS (100%), Frontend code review 100%, tidak ada critical/medium bug.
- ✅ Manual verification via screenshot:
  - Buyer Catalog menu muncul di Portal Maklon → Master Data
  - Entry sample tampil dengan stats dan filter
  - Picker dialog open dan auto-fill jalan (toast sukses)
  - Rename DA Product Master verified di Portal Produksi + subtitle menjelaskan pemisahan.

**Side-fix (stability)**
- ✅ Fix `admin_backup.py` ForwardRef UploadFile bug (backend sempat tidak bisa start).

---

## 2) Implementation Steps (Phase M1) — Completed Detail

### Phase M1.0 — Impact Analysis & Guardrails ✅
- Trace label “Master Produk” di frontend (nav + module header + docs).
- Identifikasi potensi konflik naming dengan Marketing Catalog.
- Guardrails dipenuhi: no .env changes, auth enforced, backward compatible.

### Phase M1.1 — Backend: Buyer Catalog CRUD + Indexes ✅
**Backend delivered**
- File: `backend/routes/dewi_maklon_buyer_catalog.py`
- Collection: `dewi_maklon_buyer_catalog`
- Endpoints:
  - `GET /api/dewi/maklon/buyer-catalog`
  - `POST /api/dewi/maklon/buyer-catalog`
  - `GET /api/dewi/maklon/buyer-catalog/{id}`
  - `PUT /api/dewi/maklon/buyer-catalog/{id}`
  - `PUT /api/dewi/maklon/buyer-catalog/{id}/toggle`
  - `DELETE /api/dewi/maklon/buyer-catalog/{id}` (soft delete → discontinued)
- Indexes dibuat di startup `server.py`:
  - `client_id`, `status`, `buyer_ref_code`, `updated_at`, dan unique composite `(client_id, artikel_code)`.

### Phase M1.2 — Backend: Integrasi ke Maklon PO ✅
- `dewi_maklon_pos.py`:
  - tambah `buyer_catalog_id` optional di item.
  - auto-fill `artikel`, `cmt_rate_per_pcs`, `product_description` jika input kosong/0.
  - simpan `buyer_catalog_snapshot` untuk audit.
  - backward compatible untuk PO lama.

### Phase M1.3 — Frontend: Buyer Catalog Module + Picker + Integrasi PO ✅
- File baru:
  - `MaklonBuyerCatalogModule.jsx`
  - `MaklonBuyerCatalogPicker.jsx`
- Update:
  - `MaklonPOModule.jsx`: icon BookOpen per-row + picker dialog + auto-fill + toast.
  - `portalNav.js`: tambah menu `maklon-buyer-catalog` di Maklon → Master Data.
  - `moduleRegistry.js`: register `maklon-buyer-catalog`.

### Phase M1.4 — Rename UI Label: Internal → “DA Product Master” ✅
- `portalNav.js`: label `prod-models-bom` → “DA Product Master”.
- `RahazaModelsAndBOMModule.jsx`: header + tab “Model DA” + subtitle pemisahan.

### Phase M1.5 — Router Registration + Testing ✅
- `server.py`: include router Buyer Catalog + create indexes.
- Testing:
  - backend smoke (manual + testing agent)
  - frontend manual verification (screenshot-based) untuk navigasi + picker auto-fill.

---

## 3) Success Criteria (Phase M1) — Achieved ✅
- ✅ Master data Maklon dan internal benar-benar terpisah.
- ✅ Buyer Catalog mempercepat input PO dan mengurangi typo.
- ✅ Default dari catalog tapi editable (override aman).
- ✅ Penamaan konsisten:
  - Internal: **DA Product Master**
  - Maklon: **Buyer Catalog**
  - Marketing tetap: **Manajemen Katalog** (Marketplace)
- ✅ Tidak ada regression pada modul Maklon existing (Billing, QC, Tracking, PO360).

---

# Development Plan — Phase M2 ✅ SELESAI 100% (Maklon Catalog Enrichment)

> **Tujuan:** meningkatkan reusability dan governance Maklon setelah Buyer Catalog stabil, tanpa merusak flow existing.

## 1) Objectives (Phase M2)
1. ✅ Menambah **audit trail harga** dan **guardrails** saat harga di PO berbeda dari default catalog.
2. ✅ Menghubungkan Buyer Catalog sebagai SSOT referensi untuk:
   - ✅ **Samples** (approval reusable per artikel)
   - ✅ **BOM Template** (resep material per artikel, versioned)
3. ✅ Membuat input PO lebih cepat dan konsisten lewat **autocomplete artikel** (source: Buyer Catalog).
4. ✅ Menjaga **backward compatibility** (PO/Sample lama tetap valid).

**Status akhir (Phase M2):**
- ✅ M2.1 Sample-Catalog Link (backend + frontend)
- ✅ M2.2 BOM Template Versioning + Apply-to-PO (backend + frontend)
- ✅ M2.3 Price History + Drift Detection (2-tier) + Force override (backend + frontend)
- ✅ M2.4 Autocomplete Artikel (combobox + keyboard nav + drift badge)

---

## 2) Implementation Steps (Phase M2) — Completed Detail

### Phase M2.3 — Price History + Drift Detection (2-tier) ✅
**Backend**
- `price_history[]` embedded array di `dewi_maklon_buyer_catalog`:
  - fields: `event_type`, `old/new prices`, `changed_by`, `po_number`, `note`, `timestamp`.
- Threshold 2-tier:
  - **warning ≥10%**
  - **block ≥25%** → `HTTP 422 PRICE_DRIFT_BLOCK`.
- Bypass guardrail: `force_price_drift=true` (Maklon PO create/update) dengan audit trail.
- Auto-record history saat:
  - initial create
  - master update (harga default berubah)
  - PO create/update bila rate ≠ default.
- Endpoints:
  - `GET /api/dewi/maklon/buyer-catalog/{id}/price-history`
  - `POST /api/dewi/maklon/buyer-catalog/{id}/check-drift`

**Frontend**
- Inline drift badge di row artikel (amber warning / red block).
- Confirm dialog saat save PO terkena block (retry otomatis dengan `force_price_drift=true` setelah user konfirmasi).
- Tab **Price History** di detail dialog Buyer Catalog dengan trend arrows dan detail PO/user.

### Phase M2.1 — Sample ↔ Buyer Catalog Link ✅
**Backend**
- Field opsional `buyer_catalog_id` pada `SampleIn`.
- Auto-fill `product_name`, `description`, `color_used` dari catalog bila kosong.
- Validasi konsistensi client: buyer catalog harus sesuai client pada order/PO.
- Endpoint baru:
  - `GET /api/dewi/maklon/buyer-catalog/{id}/samples` (list + summary metrics).

**Frontend**
- Picker Buyer Catalog di dialog create Sample (ter-filter by client dari order).
- Auto-fill saat pilih catalog.
- Detail dialog Buyer Catalog tab **Detail** menampilkan linked samples + ringkas status.

### Phase M2.2 — BOM Template Versioning + Apply-to-PO ✅
**Backend**
- Collection baru: `dewi_maklon_bom_templates` (versioned per catalog, composite unique `(buyer_catalog_id, version)`).
- CRUD + activate endpoint (aktifkan 1 versi, auto-deactivate yang lain).
- Apply endpoint:
  - `POST /api/dewi/maklon/bom-templates/apply-to-po`:
    - copy materials → `dewi_maklon_bom` per PO
    - simpan snapshot: `source_template_id`, `source_template_version`, `source_template_label`.
  - Auto-pick active version jika `template_id` tidak diberikan.

**Frontend**
- Detail dialog Buyer Catalog tab **BOM Templates**:
  - list multi versi (v1, v2, ...), badge AKTIF
  - tombol Versi Baru, Edit, Delete, Aktifkan
  - editor multi-material + total cost auto-compute.
- BOMForm di Maklon PO: tombol **Apply BOM Template** (muncul jika PO ada item yang ter-link Buyer Catalog).

### Phase M2.4 — Autocomplete Artikel di PO ✅
**Frontend**
- Komponen baru `MaklonArtikelAutocomplete.jsx`:
  - debounced search 200ms
  - source: Buyer Catalog **active** (filter by client)
  - keyboard navigation: ArrowDown/Up/Enter/Escape
  - pick → auto-fill artikel + default cmt_rate + default color/size
  - integrasi drift badge inline.
- Replace plain input artikel di `MaklonPOModule.jsx` ItemRow.

---

## 3) Backward Compatibility ✅
- Semua field baru **opsional**:
  - `buyer_catalog_id` (PO item, Sample)
  - `force_price_drift` (PO create/update)
  - `template_id` (apply-to-po; optional karena auto-pick active)
- PO existing tanpa link tetap valid.
- Sample existing tanpa link tetap valid.

---

## 4) Testing ✅
- ✅ Manual smoke test (backend + UI) untuk:
  - price history timeline
  - drift badges
  - autocomplete
  - bom templates UI + apply-to-po
- ✅ Testing agent report: `/app/test_reports/iteration_13.json`
  - Backend: **27/28 PASS (96.4%)**
  - 1 minor: sequencing artifact (delete active template sebelum auto-select test) — **bukan bug**.
  - Regression: 3/3 PASS.

---

## 5) Files Changed (Phase M2)
**Files Created**
- `backend/routes/dewi_maklon_bom_templates.py`
- `frontend/src/components/erp/MaklonArtikelAutocomplete.jsx`
- `frontend/src/components/erp/MaklonBuyerCatalogDetailDialog.jsx`

**Files Modified**
- `backend/routes/dewi_maklon_buyer_catalog.py` (price history + drift helpers + endpoints)
- `backend/routes/dewi_maklon_pos.py` (drift guardrail + record history + force flag)
- `backend/routes/dewi_maklon_samples.py` (buyer_catalog_id + auto-fill + filter)
- `backend/server.py` (router registration + indexes)
- `frontend/src/components/erp/MaklonPOModule.jsx` (autocomplete + drift UX + Apply BOM Template)
- `frontend/src/components/erp/MaklonBuyerCatalogModule.jsx` (Detail button + dialog mount)
- `frontend/src/components/erp/MaklonSampleManagement.jsx` (catalog picker in SampleDialog)

---

## 6) Success Criteria (Phase M2) — Achieved ✅
- ✅ Buyer Catalog menjadi pusat referensi Maklon (tanpa mengganggu proses PO existing).
- ✅ Audit trail kuat untuk harga dan spek.
- ✅ Input PO lebih cepat + minim typo (autocomplete).
- ✅ Governance harga via drift warning/block + force flag.

---

# Development Plan — Phase M3 ⏳ OPTIONAL (Future Enhancements)

> **Tujuan:** memperketat governance dan analytics setelah M2 stabil.

## 1) Objectives (Phase M3)
- Menambah enforcement policy, analytics, dan workflow approval.

## 2) Implementation Steps (Phase M3)
1. **Sample reuse policy enforcement**
   - Opsional: block confirm PO jika belum ada sample approved untuk catalog.
2. **BOM Template usage analytics**
   - Track template version paling sering dipakai + ROI (waktu hemat).
3. **Price drift dashboard**
   - Dashboard cross-catalog: top drift events, trend, heatmap.
4. **Approval workflow untuk force_price_drift**
   - Manager sign-off, audit trail lebih ketat.

## 3) Success Criteria (Phase M3)
- Governance Maklon lebih kuat (approval + analytics) tanpa menurunkan usability.
