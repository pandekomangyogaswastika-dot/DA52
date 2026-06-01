import { lazy, useEffect } from 'react';

// ─── CV. Dewi Aditya — Module Registry ────────────────────────────────────
//
// Portal baru yang ditambahkan:
//   - Portal Maklon (maklon-dashboard, maklon-*)
//   - Portal Toko Online (toko-dashboard, toko-*)
//
// Proses produksi diupdate:
//   - Rajut/Linking/Steam → Cutting/CMT-Sewing/Finishing
// ─────────────────────────────────────────────────────────────────────────────

// Helper: simple redirect component that switches to target module
function makeRedirect(targetId, tabKey) {
  return function RedirectModule({ onNavigate }) {
    useEffect(() => {
      if (tabKey) {
        // Store tab hint in sessionStorage for the target to pick up
        if (targetId === 'production-dashboard') {
          sessionStorage.setItem('prod_dashboard_tab', tabKey);
        } else if (targetId === 'prod-models-bom') {
          sessionStorage.setItem('models_bom_tab', tabKey);
        } else if (targetId === 'maklon-dashboard') {
          sessionStorage.setItem('maklon_dashboard_tab', tabKey);
        }
      }
      if (onNavigate) onNavigate(targetId);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[hsl(var(--primary))] mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Mengarahkan...</p>
        </div>
      </div>
    );
  };
}

// Helper: wrapper untuk modul dengan default tab (untuk Toko Online Phase 5B)
function makeModuleWithTab(ModuleComponent, defaultTab) {
  return function ModuleWithTabWrapper(props) {
    return <ModuleComponent {...props} defaultTab={defaultTab} />;
  };
}

// Dashboards
const ManagementDashboard = lazy(() => import('./ManagementDashboard'));
const WarehouseDashboard  = lazy(() => import('./WarehouseDashboard'));
const FinanceDashboard    = lazy(() => import('./FinanceDashboard'));
// Sprint 1.2: Replace placeholder with real HR Dashboard
const HRDashboard = lazy(() => import('./HRDashboard'));
const HRApprovalInboxModule = lazy(() => import('./HRApprovalInboxModule'));   // Phase 26 — P2 HR Approval Inbox
// Task 2.4: Multi-Level Approval Workflow
const MultiLevelApprovalModule = lazy(() => import('./MultiLevelApprovalModule'));
// Phase 3.3B: Unified Approval Hub (Aggregator)
const UnifiedApprovalHub = lazy(() => import('./UnifiedApprovalHub'));
// Task 1.2: Shift Management System
const HRShiftManagementModule = lazy(() => import('./HRShiftManagementModule'));

// Management — master data + administrasi
const ProductsModule        = lazy(() => import('./ProductsModule'));
const BuyersModule          = lazy(() => import('./BuyersModule'));
const ReportsModule         = lazy(() => import('./ReportsModule'));
const UserManagementModule  = lazy(() => import('./UserManagementModule'));
const RoleManagementModule  = lazy(() => import('./RoleManagementModule'));
const RoleMatrixModule      = lazy(() => import('./RoleMatrixModule'));
const ActivityLogModule     = lazy(() => import('./ActivityLogModule'));
const CompanySettingsModule = lazy(() => import('./CompanySettingsModule'));
const PDFConfigModule       = lazy(() => import('./PDFConfigModule'));
// Legacy HelpGuideModule replaced by RahazaUserGuideModule (Sprint 26)

// Warehouse
const ReceivingModule = lazy(() => import('./ReceivingModule'));
const PutAwayModule   = lazy(() => import('./PutAwayModule'));
const OpnameModule    = lazy(() => import('./OpnameModule'));
const LocationsModule = lazy(() => import('./LocationsModule'));
const AccessoryModule  = lazy(() => import('./AccessoryModule'));
// Portal Aksesoris dedicated modules (Session #11.21)
const AccessoriesDashboard = lazy(() => import('./AccessoriesDashboard'));
const AccessoriesReports   = lazy(() => import('./AccessoriesReports'));

// Phase B: 8 Frontend UI Modules (Finance, HR, Warehouse) - Added 2026-06-01
const AccrualsModule = lazy(() => import('./AccrualsModule'));
const AssetDepreciationModule = lazy(() => import('./AssetDepreciationModule'));
const BadDebtWriteOffModule = lazy(() => import('./BadDebtWriteOffModule'));
const AssetDisposalModule = lazy(() => import('./AssetDisposalModule'));
const PurchaseDiscountModule = lazy(() => import('./PurchaseDiscountModule'));
const EmployeeLoansModule = lazy(() => import('./EmployeeLoansModule'));
const InventoryScrapModule = lazy(() => import('./InventoryScrapModule'));

// Backup & Restore System - Added 2026-06-01
const BackupRestoreModule = lazy(() => import('./BackupRestoreModule'));

const WHReturnsModule  = lazy(() => import('./WHReturnsModule'));
const CMTPackingModule = lazy(() => import('./CMTPackingModule'));
// Task 2.5: Production Material Returns
const ProductionMaterialReturnsModule = lazy(() => import('./ProductionMaterialReturnsModule'));

// Finance — Legacy modules (InvoiceModule, PaymentModule, AccountsPayableModule,
// AccountsReceivableModule, ManualInvoiceModule) REMOVED in Session #11.17.
// Backend routes were deleted in Session #11.16 Phase D (finance.py + dewi_kol.py).
// Use SSOT modules: fin-ar-invoices (AR Invoices), fin-ar-360 (AR Aging),
// fin-ap-aging (AP Aging), maklon-billing (Maklon Invoices).
const FinancialRecapModule     = lazy(() => import('./FinancialRecapModule'));
const ThreeWayMatchModule      = lazy(() => import('./ThreeWayMatchModule'));     // Phase 27 — 3-way match dashboard
const ARLifecycleModule        = lazy(() => import('./ARLifecycleModule'));       // Phase 30 — AR 360° (Aging + Customer Statement)
const ApprovalModule           = lazy(() => import('./ApprovalModule'));
// Finance · Bank Reconciliation (P1)
const BankReconciliation       = lazy(() => import('./finance/BankReconciliation'));
const CashFlowAI               = lazy(() => import('./finance/CashFlowAI'));

// Produksi · Master Data Rajut (PT Rahaza)
const RahazaLocationsModule = lazy(() => import('./RahazaLocationsModule'));
const RahazaProcessesModule = lazy(() => import('./RahazaProcessesModule'));
const RahazaShiftsModule    = lazy(() => import('./RahazaShiftsModule'));
const RahazaMachinesModule  = lazy(() => import('./RahazaMachinesModule'));
const RahazaLinesModule     = lazy(() => import('./RahazaLinesModule'));
const RahazaEmployeesModule = lazy(() => import('./RahazaEmployeesModule'));
const RahazaModelsModule    = lazy(() => import('./RahazaModelsModule'));
const RahazaSizesModule     = lazy(() => import('./RahazaSizesModule'));
const RahazaLineAssignmentsModule = lazy(() => import('./RahazaLineAssignmentsModule'));
const LineBoardModule              = lazy(() => import('./LineBoardModule'));
const ProductionDashboardModule    = lazy(() => import('./ProductionDashboardModule'));
const ProductionControlTowerModule = lazy(() => import('./ProductionControlTowerModule')); // Phase 28 — P2 Workflow Consolidation #3
const RahazaCustomersModule        = lazy(() => import('./RahazaCustomersModule'));
const RahazaOrdersModule           = lazy(() => import('./RahazaOrdersModule'));
// RahazaBOMModule (v1, 406 LOC) REMOVED — Session #12 P1 dead code cleanup.
// 'prod-bom' → makeRedirect('prod-models-bom', 'bom') → uses RahazaModelsAndBOMModule (v2, SSOT).
// File archived at: src/components/erp/_archive/RahazaBOMModule.jsx
const RahazaWorkOrdersModule       = lazy(() => import('./RahazaWorkOrdersModule'));
const RahazaBundlesModule          = lazy(() => import('./RahazaBundlesModule'));
const BundleReworkBoard            = lazy(() => import('./BundleReworkBoard'));
const RahazaAlertSettingsModule    = lazy(() => import('./RahazaAlertSettingsModule'));
const ProcessExecutionModule       = lazy(() => import('./ProcessExecutionModule'));
const SimpleDailyInputModule       = lazy(() => import('./SimpleDailyInputModule'));
const RahazaMaterialsModule        = lazy(() => import('./RahazaMaterialsModule'));
const RahazaStockModule            = lazy(() => import('./RahazaStockModule'));
const RahazaMaterialIssueModule    = lazy(() => import('./RahazaMaterialIssueModule'));
const RahazaAttendanceModule       = lazy(() => import('./RahazaAttendanceModule'));
const RahazaPayrollProfilesModule  = lazy(() => import('./RahazaPayrollProfilesModule'));
const RahazaPayrollRunModule       = lazy(() => import('./RahazaPayrollRunModule'));
const RahazaCostCentersModule      = lazy(() => import('./RahazaCostCentersModule'));
const RahazaARInvoicesModule       = lazy(() => import('./RahazaARInvoicesModule'));
const RahazaCashAccountsModule     = lazy(() => import('./RahazaCashAccountsModule'));
const RahazaExpensesModule         = lazy(() => import('./RahazaExpensesModule'));
const RahazaHPPModule              = lazy(() => import('./RahazaHPPModule'));
const ManagementOverviewModule     = lazy(() => import('./ManagementOverviewModule'));
const RahazaShipmentsModule        = lazy(() => import('./RahazaShipmentsModule'));
const AndonBoardModule             = lazy(() => import('./AndonBoardModule'));
const RahazaSOPModule              = lazy(() => import('./RahazaSOPModule'));
const APSGanttModule               = lazy(() => import('./APSGanttModule'));
const OeeDashboardModule           = lazy(() => import('./OeeDashboardModule'));
const ReworkAnalyticsModule        = lazy(() => import('./ReworkAnalyticsModule'));

// Finance · Accounting Core (Phase F1)
const RahazaCOAModule             = lazy(() => import('./RahazaCOAModule'));
const RahazaJournalEntryModule    = lazy(() => import('./RahazaJournalEntryModule'));
const RahazaTrialBalanceModule    = lazy(() => import('./RahazaTrialBalanceModule'));
const RahazaPeriodsModule         = lazy(() => import('./RahazaPeriodsModule'));
const RahazaGeneralLedgerModule   = lazy(() => import('./RahazaGeneralLedgerModule'));

// Finance · Accounting Core (Phase F2)
const RahazaPostingProfilesModule = lazy(() => import('./RahazaPostingProfilesModule'));

// Phase 7: Marketing AR Bridge & Admin Setup Panel
const MarketingARBridgeModule     = lazy(() => import('./MarketingARBridgeModule'));
const AdminSetupPanelModule       = lazy(() => import('./AdminSetupPanelModule'));

const RahazaPnLModule             = lazy(() => import('./RahazaPnLModule'));
const RahazaHRReportsModule       = lazy(() => import('./RahazaHRReportsModule'));
const RahazaBalanceSheetModule    = lazy(() => import('./RahazaBalanceSheetModule'));
const RahazaJournalListModule     = lazy(() => import('./RahazaJournalListModule'));
const RahazaAPAgingModule         = lazy(() => import('./RahazaAPAgingModule'));

// Finance · Accounting Core (Phase F3)
const RahazaCashFlowModule        = lazy(() => import('./RahazaCashFlowModule'));
const BudgetModule                = lazy(() => import('./BudgetModule'));
const FixedAssetsModule           = lazy(() => import('./FixedAssetsModule'));

// Session 13 — SLA, Management Tools, Smart Warehouse
const MaklonSLADashboard         = lazy(() => import('./MaklonSLADashboard'));
const ManagementToolsModule      = lazy(() => import('./ManagementToolsModule'));
const WarehouseSmartModule       = lazy(() => import('./WarehouseSmartModule'));

// Phase 1/2 — Marketing Webhooks + Capacity Planning
const MarketingWebhooksModule    = lazy(() => import('./marketing/MarketingWebhooksModule'));
const ProcurementRequestModule  = lazy(() => import('./ProcurementRequestModule'));
const CapacityPlanningModule     = lazy(() => import('./CapacityPlanningModule'));

// Phase 2 Task 2.2 — Real-time Line Monitoring Dashboard
const LineMonitoringModule       = lazy(() => import('./LineMonitoringModule'));

// Phase 3 — Live Session Analytics + Payroll Dashboard + Executive Report
const LiveSessionAnalyticsDashboard = lazy(() => import('./marketing/LiveSessionAnalyticsDashboard'));
const PayrollDashboardModule      = lazy(() => import('./PayrollDashboardModule'));
const ExecutiveReportModule       = lazy(() => import('./ExecutiveReportModule'));

// Session 14 — AI Business Intelligence
const AIBusinessDashboard        = lazy(() => import('./AIBusinessDashboard'));

// Phase 21 — Decision Support & Quality Metrics
const RahazaDefectCodesModule     = lazy(() => import('./RahazaDefectCodesModule'));
const RahazaParetoModule          = lazy(() => import('./RahazaParetoModule'));
const RahazaFPYModule             = lazy(() => import('./RahazaFPYModule'));
const RahazaDowntimeModule        = lazy(() => import('./RahazaDowntimeModule'));
const RahazaBacklogModule         = lazy(() => import('./RahazaBacklogModule'));

// Phase 20C — AI Layer
const RahazaAIModule              = lazy(() => import('./RahazaAIModule'));

// Staff Self-Service Portal
const SelfServicePortal           = lazy(() => import('./SelfServicePortal'));

// Portal Saya — Self-Service HR + My Workspace
const PortalSayaDashboard         = lazy(() => import('./PortalSayaDashboard'));
const PortalSayaProfile           = lazy(() => import('./PortalSayaProfile'));
const PortalSayaCuti              = lazy(() => import('./PortalSayaCuti'));
const PortalSayaPayslip           = lazy(() => import('./PortalSayaPayslip'));
const PortalSayaTraining          = lazy(() => import('./PortalSayaTraining'));
const PortalSayaNotifikasi        = lazy(() => import('./PortalSayaNotifikasi'));
const WorkspaceHub                = lazy(() => import('./WorkspaceHub'));

// Phase 8 — DA KPI System
const HRKPIModule                 = lazy(() => import('./HRKPIModule'));
const KPIPortalModule             = lazy(() => import('./KPIPortalModule'));

// Phase 8 — DA Employee Assets & Payroll Allowances
const HRAssetModule               = lazy(() => import('./HRAssetModule'));
const RahazaPayrollAllowancesModule = lazy(() => import('./RahazaPayrollAllowancesModule'));

// Sprint 42 — Salary Adjustment (Raise) Workflow with Dual Approval
const RahazaSalaryAdjustmentModule = lazy(() => import('./RahazaSalaryAdjustmentModule'));

// Phase 8.6 — AI Action Items
const AIActionsModule             = lazy(() => import('./AIActionsModule'));

// Phase 8.7 — HR Employee full-field module (replaces RahazaEmployeesModule)
const HREmployeeModule            = lazy(() => import('./HREmployeeModule'));

// Phase 8.8-9.1 — Leave Balances + Overtime Request
const HRLeaveBalancesModule       = lazy(() => import('./HRLeaveBalancesModule'));
const RahazaOvertimeModule        = lazy(() => import('./RahazaOvertimeModule'));

// Phase 9.2+ — HR Admin (Salary Grades, Resignation, Office, Seed) + 360 Feedback
const HRAdminModule               = lazy(() => import('./HRAdminModule'));
const HR360FeedbackModule         = lazy(() => import('./HR360FeedbackModule'));

// Phase 7.9 — WMS Pick List Generator
const WMSPickListModule           = lazy(() => import('./WMSPickListModule'));
// WMS P0/P1 Garment Features
const WMSFabricRollsModule        = lazy(() => import('./WMSFabricRollsModule'));
const WMSDeliveryNotesModule      = lazy(() => import('./WMSDeliveryNotesModule'));
const WMSCMTDispatchesModule      = lazy(() => import('./WMSCMTDispatchesModule'));
const WMSOpnameEnhancedModule     = lazy(() => import('./WMSOpnameEnhancedModule'));

// ─── Portal Maklon (Fase 3) ───────────────────────────────────────────────────
const MaklonDashboard = lazy(() => import('./MaklonDashboard'));
const MaklonClientManagement = lazy(() => import('./MaklonClientManagement'));
// MaklonOrderModule removed (Phase C cleanup 2026-05-23) — module was redirected
// to maklon-po (MaklonPOModule). All Maklon order CRUD now happens at /api/dewi/maklon/pos.
// Fase 3B: Sample & QC
const MaklonSampleManagement = lazy(() => import('./MaklonSampleManagement'));
const MaklonQCTracking = lazy(() => import('./MaklonQCTracking'));
const MaklonProductionTracking = lazy(() => import('./MaklonProductionTracking'));
// Fase 3C: Billing & HPP
const MaklonBillingModule = lazy(() => import('./MaklonBillingModule'));
const MaklonHppModule = lazy(() => import('./MaklonHppModule'));
const MaklonSystemConfigModule = lazy(() => import('./MaklonSystemConfigModule'));
const NotificationCenterModule = lazy(() => import('./NotificationCenterModule'));

// ── Production-Maklon Overhaul — New Modules ────────────────────────────────
const MaklonPOModule    = lazy(() => import('./MaklonPOModule'));       // PO+Seri CRUD + multi-dispatch
const MaklonPO360Module = lazy(() => import('./MaklonPO360Module'));    // 360° unified view per PO (Phase 25)
const CMTProgressModule = lazy(() => import('./CMTProgressModule'));    // CMT progress + DO
const CMTLifecycleModule = lazy(() => import('./CMTLifecycleModule'));   // Phase 29 — Vendor lifecycle dashboard
const VendorPortalModule = lazy(() => import('./VendorPortalModule'));   // Session #11.21 — Vendor CMT self-service portal
const VendorAccountsAdminModule = lazy(() => import('./VendorAccountsAdminModule'));  // Session #11.21 — Admin kelola vendor

// ─── Portal Toko Online → Marketing (rebrand in-place) ────────────────────────
// `toko-dashboard` sekarang = MarketingDashboard (Phase 1+2 Marketing Portal).
// Legacy TokoDashboardModule disimpan sebagai redirect ke toko-dashboard (Phase 3.3A)
const MarketingDashboard = lazy(() => import('./MarketingDashboard'));
const AccountManagementModule = lazy(() => import('./AccountManagementModule'));
const SalesDataEntryModule = lazy(() => import('./SalesDataEntryModule'));
const TaskManagementModule = lazy(() => import('./TaskManagementModule'));
const ApprovalInboxModule = lazy(() => import('./ApprovalInboxModule'));
const TaskTemplatesModule = lazy(() => import('./TaskTemplatesModule'));
// Consolidation #9 & #10 — Hub modules (2026-05-23)
const MarketingAfterSalesHub  = lazy(() => import('./MarketingAfterSalesHub'));   // Komplain + Returns + Log
const MarketingTaskHubModule   = lazy(() => import('./MarketingTaskHubModule'));  // Kanban + Approval + Templates
// Consolidation #3 & #13 — Warehouse + Production master hubs (2026-05-23)
const WarehouseMasterHub        = lazy(() => import('./WarehouseMasterHub'));         // Material + FG Master
const ProductionWorkspaceMaster = lazy(() => import('./ProductionWorkspaceMaster')); // Lokasi + Lini + Mesin + Shift
// Consolidation #8 & #14 — Marketing Reports + HR Performance hubs (2026-05-23)
const MarketingReportsHub   = lazy(() => import('./MarketingReportsHub'));   // Overview + Sales + Ads + Daily + Monthly
const HRPerformanceHub      = lazy(() => import('./HRPerformanceHub'));      // KPI + Annual Review + 360° Feedback
const SmartImportModule = lazy(() => import('./SmartImportModule'));
const ImportCenterModule = lazy(() => import('./ImportCenterModule'));
const CatalogManagementModule = lazy(() => import('./CatalogManagementModule'));
const KOLCreatorModule = lazy(() => import('./KOLCreatorModule'));

// Phase 2 Week 4-5: Orders & Complaints Management
const UnifiedOrdersDashboard = lazy(() => import('./marketing/UnifiedOrdersDashboard'));
const ComplaintsManagementModule = lazy(() => import('./marketing/ComplaintsManagementModule'));

// Phase 3 Week 6-7: Account Health, Sales Performance, Ads, Live Sessions
const AccountHealthDashboard = lazy(() => import('./marketing/AccountHealthDashboard'));
const SalesPerformanceDashboard = lazy(() => import('./marketing/SalesPerformanceDashboard'));
const AdsPerformanceDashboard = lazy(() => import('./marketing/AdsPerformanceDashboard'));
const LiveSessionModule = lazy(() => import('./marketing/LiveSessionModule'));

// Phase 3 Week 8-10: Content Calendar, Discount Campaign, Product Launch
const ContentCalendarModule = lazy(() => import('./marketing/ContentCalendarModule'));
const DiscountCampaignModule = lazy(() => import('./marketing/DiscountCampaignModule'));
const ProductLaunchModule = lazy(() => import('./marketing/ProductLaunchModule'));

// Phase 3 Week 11-12: Marketing Overview Dashboard + Integration Settings
const MarketingOverviewDashboard = lazy(() => import('./marketing/MarketingOverviewDashboard'));
const MarketingAIInsightsDashboard = lazy(() => import('./marketing/MarketingAIInsightsDashboard'));
const AdvancedAIModule = lazy(() => import('./marketing/AdvancedAIModule'));
const MarketingIntegrationSettings = lazy(() => import('./marketing/MarketingIntegrationSettings'));

// Session 12: AI Content & Image Generator, KOL Leaderboard, Scheduler
const AIContentGeneratorModule = lazy(() => import('./marketing/AIContentGeneratorModule'));
const AIImageGeneratorModule   = lazy(() => import('./marketing/AIImageGeneratorModule'));
const KOLLeaderboardModule     = lazy(() => import('./marketing/KOLLeaderboardModule'));
const MarketingSchedulerModule = lazy(() => import('./marketing/MarketingSchedulerModule'));

// Phase 3 Week 13: Fitur Internal (Rating/Review, Returns, Sample Delivery)
const RatingReviewModule = lazy(() => import('./marketing/RatingReviewModule'));
const ReturnsRefundsModule = lazy(() => import('./marketing/ReturnsRefundsModule'));
const SampleDeliveryModule = lazy(() => import('./marketing/SampleDeliveryModule'));
// Session 28 — LiveHost Management (Phase 1-4)
const LiveHostModule = lazy(() => import('./marketing/LiveHostModule'));
// Session 28 — Marketing PIC Reports & Targets
const AccountTargetsModule = lazy(() => import('./marketing/AccountTargetsModule'));
const DailyReportModule    = lazy(() => import('./marketing/DailyReportModule'));
const MonthlyReportModule  = lazy(() => import('./marketing/MonthlyReportModule'));

// DEPRECATED (Phase 3.3A): toko-dashboard-legacy dan toko-dashboard-classic sekarang redirect ke toko-dashboard SSOT
// const TokoDashboard = lazy(() => import('./TokoDashboard'));
// const TokoDashboardModule = lazy(() => import('./TokoDashboardModule'));
const TokoProductCatalogModule = lazy(() => import('./TokoProductCatalogModule'));
const TokoChannelManagerModule = lazy(() => import('./TokoChannelManagerModule'));
// Phase 5B: Orders, Pricing/Flashsale, KOL, CS/Returns
const TokoOrdersModule = lazy(() => import('./TokoOrdersModule'));
const FulfillmentModule = lazy(() => import('./FulfillmentModule'));  // Phase 6: Online Order Bridge
const DOManagementModule = lazy(() => import('./DOManagementModule'));  // Phase 2 Enhancement: DO System
const UnifiedInventoryModule = lazy(() => import('./UnifiedInventoryModule'));  // Phase 2 Enhancement: Unified Inventory
const Phase7ReportingModule = lazy(() => import('./Phase7ReportingModule'));  // Phase 7: Laporan & Dashboard
const TokoPricingFlashsaleModule = lazy(() => import('./TokoPricingFlashsaleModule'));
// TokoKOLModule removed in Session #11.17 — use marketing-kol (SSOT KOL Mgmt),
// marketing-kol-leaderboard (SSOT KOL Leaderboard), marketing-creators (Creator Portal).
const TokoCSReturnsModule = lazy(() => import('./TokoCSReturnsModule'));

// ─── Fase 2: Cutting & CMT ────────────────────────────────────────────────────
const CuttingProcessModule = lazy(() => import('./CuttingProcessModule'));
const CuttingHubModule     = lazy(() => import('./CuttingHubModule')); // P2 Consolidation #2 (Session #11 cont.)
const CMTManagementModule  = lazy(() => import('./CMTManagementModule'));

// ─── Phase 6 — HRIS (Full) ───────────────────────────────────────────────────
const HRPerformanceModule = lazy(() => import('./HRPerformanceModule'));
const HRLMSModule = lazy(() => import('./HRLMSModule'));
const HROnboardingModule = lazy(() => import('./HROnboardingModule'));
const HRATSModule = lazy(() => import('./HRATSModule'));
const HROrgChartModule = lazy(() => import('./HROrgChartModule'));

// ─── Phase 7 — RnD & Style Master ────────────────────────────────────────────
const RnDModule = lazy(() => import('./RnDModule'));

// ─── Session 26 — Portal RnD (dedicated portal, 2026-05-15) ─────────────────
const RnDPortalDashboard      = lazy(() => import('./RnDPortalDashboard'));
const RnDVariantModule        = lazy(() => import('./RnDVariantModule'));
const RnDPatternModule        = lazy(() => import('./RnDPatternModule'));
const RnDHPPCalculatorModule  = lazy(() => import('./RnDHPPCalculatorModule'));
const RnDAnalyticsModule      = lazy(() => import('./RnDAnalyticsModule'));
// Re-use existing tabs as standalone portal modules:
const RnDStylesTab    = lazy(() => import('./RnDStylesTab'));
const RnDSamplesTab   = lazy(() => import('./RnDSamplesTab'));
const RnDMaterialsTab = lazy(() => import('./RnDMaterialsTab'));
const RnDCostingTab   = lazy(() => import('./RnDCostingTab'));
const RnDRevisionsTab = lazy(() => import('./RnDRevisionsTab'));
// Session 27 — Tech Pack Manager + Style Detail View
const RnDTechPackModule = lazy(() => import('./RnDTechPackModule'));
const RnDStyleDetailPage = lazy(() => import('./RnDStyleDetailPage'));

// ─── Session 27 — GAP P0 SOP (KREATOR Requests, Accessory Requests, CMT Shortage) ──
const KREATORRequestModule       = lazy(() => import('./KREATORRequestModule'));
const AccessoryRequestInbox      = lazy(() => import('./AccessoryRequestInbox'));
const CMTComponentRequestModule  = lazy(() => import('./CMTComponentRequestModule'));

// Sprint 2.1 — Purchase Orders
const PurchaseOrderModule = lazy(() => import('./PurchaseOrderModule'));
// Sprint 2.3 — Leave Management
const RahazaLeaveModule = lazy(() => import('./RahazaLeaveModule'));

// Sprint 42 — Smart Auto-Attendance (Selfie+AI, WebAuthn, ZKTeco, Approval Queue)
const RahazaAutoAttendanceModule = lazy(() => import('./RahazaAutoAttendanceModule'));
const RahazaAttendanceApprovalModule = lazy(() => import('./RahazaAttendanceApprovalModule'));
// Sprint 3.1 — HR Reports
const RahazaBulkMIModule        = lazy(() => import('./RahazaBulkMIModule'));
const RahazaLineBalancingModule = lazy(() => import('./RahazaLineBalancingModule'));

// Phase 22B — Shift Handover, Material Reservation, Production Calendar
const RahazaShiftHandoverModule      = lazy(() => import('./RahazaShiftHandoverModule'));
const RahazaMaterialReservationModule = lazy(() => import('./RahazaMaterialReservationModule'));
const RahazaProductionCalendarModule  = lazy(() => import('./RahazaProductionCalendarModule'));
// Phase 23 — OEE Dashboard
const RahazaOEEModule = lazy(() => import('./RahazaOEEModule'));
// User Guide
const RahazaUserGuideModule = lazy(() => import('./RahazaUserGuideModule'));
// Sprint 27 — AQL Sampling Calculator
const RahazaAQLCalculatorModule = lazy(() => import('./RahazaAQLCalculatorModule'));

// Navigation Refinement — New Combined Modules
const RahazaModelsAndBOMModule  = lazy(() => import('./RahazaModelsAndBOMModule'));
const IntegrationSettingsModule = lazy(() => import('./IntegrationSettingsModule'));

// FG Inventory (Produk Jadi)
const RahazaFGInventoryModule   = lazy(() => import('./RahazaFGInventoryModule'));

// Session 22 (Phase 4) — P1 GRN Quality Check + Supplier Scorecard
const SupplierScorecardModule   = lazy(() => import('./SupplierScorecardModule'));

// WMS (Phase 7 — Warehouse Management System w/ Scanner)
const WMSModule                 = lazy(() => import('./WMSModule'));

// Production Automation (Phase 4)
const ProductionWizardModule = lazy(() => import('./ProductionWizardModule'));

// Session 15 — HR AI & Portal Saya Extensions
const HRResumeScreeningModule = lazy(() => import('./hr/HRResumeScreeningModule'));
const HRAttritionModule = lazy(() => import('./hr/HRAttritionModule'));
const HRCoachingModule = lazy(() => import('./hr/HRCoachingModule'));
const MyDocumentsModule = lazy(() => import('./portal/MyDocumentsModule'));
const MyAnnualReviewModule = lazy(() => import('./portal/MyAnnualReviewModule'));
const PeerFeedbackModule = lazy(() => import('./portal/PeerFeedbackModule'));

// Session 17 Batch 1 — HR/SDM Features (P2-11, P2-12, P2-16)
const ShiftSchedulerModule = lazy(() => import('./hr/ShiftSchedulerModule'));
const JobBoardModule = lazy(() => import('./hr/JobBoardModule'));
const CareerCoachModule = lazy(() => import('./portal/CareerCoachModule'));

// Session 18 — P2-20 Skill Gap Analysis (HR)
const HRSkillGapModule = lazy(() => import('./hr/HRSkillGapModule'));

// Session 18 — P2-3 OKR Tracker, P2-7 Predictive Maintenance, P2-19 Maklon AI Quote
const OKRTrackerModule = lazy(() => import('./OKRTrackerModule'));
const PredictiveMaintenanceModule = lazy(() => import('./PredictiveMaintenanceModule'));
const MaklonAIQuoteModule = lazy(() => import('./MaklonAIQuoteModule'));

// Session 19 — E-3: AI Usage Monitor (Admin only)
const AIUsageMonitorModule = lazy(() => import('./AIUsageMonitorModule'));

// ─── Employee Expense Management (EEM) ────────────────────────────────────
const EmployeeExpenseModule      = lazy(() => import('./EmployeeExpenseModule'));
const EmployeeTravelModule       = lazy(() => import('./EmployeeTravelModule'));
const EmployeeExpenseApprovalModule = lazy(() => import('./EmployeeExpenseApprovalModule'));
const EmployeePerDiemAdminModule = lazy(() => import('./EmployeePerDiemAdminModule'));
const EmployeeTravelSettlementModule = lazy(() => import('./EmployeeTravelSettlementModule'));
const EmployeeExpenseGLMappingModule = lazy(() => import('./EmployeeExpenseGLMappingModule'));
const EmployeeExpenseCategoryMasterModule = lazy(() => import('./EmployeeExpenseCategoryMasterModule')); // Phase 5D
const PettyCashModule      = lazy(() => import('./PettyCashModule'));      // Phase 6B
const BankTransferModule   = lazy(() => import('./BankTransferModule'));   // Phase 6C

// Module map — id → component. IDs MUST be unique.
export const MODULE_REGISTRY = {
  // Portal dashboards
  'management-dashboard': ManagementDashboard,
  'production-dashboard': ProductionDashboardModule,
  'prod-control-tower':   ProductionControlTowerModule,    // Phase 28 — Unified daily ops dashboard
  'warehouse-dashboard':  WarehouseDashboard,
  'finance-dashboard':    FinanceDashboard,
  // Sprint 1.2: Real HR Dashboard
  'hr-dashboard':         HRDashboard,
  'hr-inbox':             HRApprovalInboxModule,    // Phase 26 — Unified HR Approval Inbox
  'approval-multilevel':  MultiLevelApprovalModule,  // Task 2.4 — Multi-Level Approval Workflow
  'hr-shift-management':  HRShiftManagementModule,   // Task 1.2 — Shift Management System

  // ─── Employee Expense Management (EEM) ─────────────────────────────────
  'hr-expense-claims':        EmployeeExpenseModule,          // Klaim Biaya / Reimbursement
  'hr-travel-requests':       EmployeeTravelModule,           // Perjalanan Dinas
  'hr-travel-settlement':     EmployeeTravelSettlementModule, // Settlement Perjalanan Dinas
  'hr-expense-approval':      EmployeeExpenseApprovalModule,  // Approval Inbox (HR + Finance)
  'hr-per-diem-config':       EmployeePerDiemAdminModule,     // Konfigurasi Per Diem (Admin)
  'fin-expense-settlement':   EmployeeExpenseApprovalModule,  // Finance entry-point (same component)
  'fin-settlement-queue':     EmployeeTravelSettlementModule, // Finance settlement queue (entry point for Finance)
  'fin-gl-mapping-config':    EmployeeExpenseGLMappingModule, // GL Mapping Configuration (Finance/Admin)
  'fin-expense-category-master': EmployeeExpenseCategoryMasterModule, // Master Kategori Expense (Phase 5D)
  'fin-petty-cash':     PettyCashModule,    // Kas Kecil / Petty Cash (Phase 6B)
  'fin-bank-transfer':  BankTransferModule, // Transfer Bank Antar Rekening (Phase 6C)
  // Sprint 1.3: Master Karyawan exposed in HR portal
  'hr-employees':         HREmployeeModule,
  // Sprint 42: Smart Auto-Attendance
  'hr-auto-attendance':   RahazaAutoAttendanceModule,
  'hr-attendance-approval': RahazaAttendanceApprovalModule,
  // Management · Master Data & Admin
  'mgmt-customers':    BuyersModule,
  'mgmt-reports':      ReportsModule,
  'mgmt-users':        UserManagementModule,
  'mgmt-roles':        RoleManagementModule,
  'mgmt-role-matrix':  RoleMatrixModule,
  'mgmt-activity':     ActivityLogModule,
  'mgmt-company':      CompanySettingsModule,
  'mgmt-pdf':          PDFConfigModule,
  'mgmt-help':         RahazaUserGuideModule,

  // Warehouse
  'wh-receiving':  ReceivingModule,
  'wh-putaway':    PutAwayModule,
  'wh-opname':     OpnameModule,
  'wh-bin':        LocationsModule,
  'wh-accessory':  AccessoryModule,
  'wh-returns':    WHReturnsModule,
  // Sprint 2.1: Purchase Orders
  'wh-purchase-orders': PurchaseOrderModule,
  // Phase 7 — WMS (Scanner-based)
  'wms':           WMSModule,

  // Finance — Legacy module IDs (fin-ar, fin-ap, fin-invoices, fin-manual-invoice, fin-payments)
  // REMOVED in Session #11.17 (post Phase D). Backend routes already 404 (Session #11.16 Phase D).
  // Use SSOT routes instead: fin-ar-invoices, fin-ar-360, fin-ap-aging, maklon-billing.
  'fin-3way-match':    ThreeWayMatchModule,         // Phase 27 — PO ↔ GR ↔ AP 3-way reconciliation
  'fin-ar-360':        ARLifecycleModule,           // Phase 30 — AR 360° (Aging matrix + customer statement)
  'fin-approval':      ApprovalModule,
  'fin-recap':         FinancialRecapModule,
  // Finance · Bank Reconciliation (P1)
  'fin-bank-recon':    BankReconciliation,
  'fin-ai-cashflow':   CashFlowAI,

  // Produksi · Master Data (Fase 3)
  'prod-locations': RahazaLocationsModule,   // deeplink backward compat
  'prod-processes': RahazaProcessesModule,
  'prod-shifts':    RahazaShiftsModule,      // deeplink backward compat
  'prod-machines':  RahazaMachinesModule,    // deeplink backward compat
  'prod-lines':     RahazaLinesModule,       // deeplink backward compat
  'prod-employees': RahazaEmployeesModule,
  // Consolidation #13: Production Workspace Master (replaces 4 entries in sidebar)
  'prod-workspace-master': ProductionWorkspaceMaster,

  // Input Harian Sederhana (tanpa bundle/line — beriringan dengan existing flow)
  'prod-simple-input': SimpleDailyInputModule,

  // Produksi · Eksekusi (Fase 4)
  'prod-assignments':  RahazaLineAssignmentsModule,
  'prod-bulk-mi':      RahazaBulkMIModule,
  'prod-line-board':   LineBoardModule,

  // Phase 2 Task 2.2 — Real-time Line Monitoring Dashboard
  'prod-monitoring':   LineMonitoringModule,

  // Produksi · Order (Fase 5a)
  'prod-orders':       RahazaOrdersModule,

  // Produksi · BOM + WO (Fase 5b & 5c)
  'prod-work-orders':  RahazaWorkOrdersModule,

  // Produksi · Bundle Traceability (Phase 17A)
  'prod-bundles':      RahazaBundlesModule,

  // ── P0 FIX: Previously broken menus ────────────────────────────────────
  // Papan Rework — was missing mapping, falls back to ManagementDashboard
  'prod-rework-board':    BundleReworkBoard,
  // Pengaturan Alert — was missing mapping
  'prod-alert-settings':  RahazaAlertSettingsModule,

  // Produksi · Eksekusi Proses — CV. Dewi Aditya (Cutting/CMT/Finishing/QC/Packing)
  'prod-exec-cutting':  ProcessExecutionModule,
  'prod-exec-sewing':   ProcessExecutionModule,
  'prod-exec-finishing':ProcessExecutionModule,
  'prod-exec-qc':       ProcessExecutionModule,
  'prod-exec-rework':   ProcessExecutionModule,
  'prod-exec-packing':  ProcessExecutionModule,
  // Legacy PT Rahaza (redirect ke proses setara, backward compat)
  'prod-exec-rajut':    makeRedirect('prod-exec-cutting'),
  'prod-exec-linking':  makeRedirect('prod-exec-sewing'),
  'prod-exec-steam':    makeRedirect('prod-exec-finishing'),
  'prod-exec-washer':   makeRedirect('prod-exec-rework'),
  'prod-exec-sontek':   makeRedirect('prod-exec-rework'),

  // Warehouse · Inventory Rahaza (Fase 7)
  'wh-materials':      RahazaMaterialsModule,     // deeplink backward compat
  'wh-stock':          RahazaStockModule,
  // Consolidation #3: Master Hub (replaces wh-materials + wh-fg in sidebar)
  'wh-master':         WarehouseMasterHub,
  'wh-material-issue': RahazaMaterialIssueModule,
  // Accessory modules (mapped from restructured IA)
  'wh-accessory-master': RahazaMaterialsModule,  // Reuse materials module for accessory master
  'wh-accessory-stock':  RahazaStockModule,      // Reuse stock module for accessory stock
  'wh-accessory-ops':    AccessoryModule,         // Original accessory operations module
  // FG Inventory
  'wh-fg':             RahazaFGInventoryModule,   // deeplink backward compat

  // Session 22 (Phase 4) — Supplier Quality Scorecard (P1 GRN QC)
  'wh-supplier-scorecard': SupplierScorecardModule,

  // HR · Attendance (Fase 8a)
  'hr-attendance':     RahazaAttendanceModule,
  'hr-overtime':       RahazaOvertimeModule,

  // HR · Payroll (Fase 8b + 8c)
  'hr-payroll-profiles':  RahazaPayrollProfilesModule,
  'hr-payroll-run':       RahazaPayrollRunModule,
  'hr-payroll-dashboard': PayrollDashboardModule,      // Phase 3 — Payroll Automation Dashboard

  // Sprint 2.3: Leave Management
  'hr-leave':            RahazaLeaveModule,
  'hr-leave-balances':   HRLeaveBalancesModule,
  'hr-admin':            HRAdminModule,
  'hr-360-feedback':     HR360FeedbackModule,         // deeplink backward compat
  // Consolidation #14: HR Performance Hub (replaces 3 entries in sidebar)
  'hr-performance-hub':  HRPerformanceHub,
  
  // Sprint 3.1: HR Reports
  'hr-reports':          RahazaHRReportsModule,

  // Finance · Enhanced (Fase 8.5)
  'fin-cost-centers':  RahazaCostCentersModule,
  'fin-ar-invoices':   RahazaARInvoicesModule,
  'fin-cash':          RahazaCashAccountsModule,
  'fin-expenses':      RahazaExpensesModule,

  // Finance · HPP (Fase 9)
  'fin-hpp':           RahazaHPPModule,

  // Management · Overview (Fase 10)
  'mgmt-overview':     ManagementOverviewModule,

  // Produksi · Sales Closure (Fase 14)
  'prod-shipments':    RahazaShipmentsModule,

  // Management · Master Data (Fase 5a — ganti BuyersModule dengan Rahaza Customers)
  'mgmt-rahaza-customers': RahazaCustomersModule,

  // Produksi · Andon Panel (Phase 18B)
  'prod-andon-board': AndonBoardModule,

  // Produksi · SOP Inline (Phase 18D)
  'prod-sop': RahazaSOPModule,

  // Finance · Accounting Core (Phase F1)
  'fin-coa':               RahazaCOAModule,
  'fin-journal-entry':     RahazaJournalEntryModule,
  'fin-trial-balance':     RahazaTrialBalanceModule,
  'fin-general-ledger':    RahazaGeneralLedgerModule,
  'fin-periods':           RahazaPeriodsModule,

  // Finance · Accounting Core (Phase F2)
  'fin-posting-profiles':  RahazaPostingProfilesModule,
  'fin-pnl':               RahazaPnLModule,
  'fin-balance-sheet':     RahazaBalanceSheetModule,
  'fin-journal-list':      RahazaJournalListModule,
  'fin-ap-aging':          RahazaAPAgingModule,

  // Finance · Accounting Core (Phase F3)
  'fin-cash-flow':         RahazaCashFlowModule,
  'fin-budget':            BudgetModule,
  'fin-fixed-assets':      FixedAssetsModule,
  'fin-executive-report':  ExecutiveReportModule,      // Phase 3 — Executive Report Hub

  // Finance · Phase B (2026-06-01) — 8 UI Modules for Advanced Features
  'fin-accruals':              AccrualsModule,
  'fin-asset-depreciation':    AssetDepreciationModule,
  'fin-bad-debt-writeoff':     BadDebtWriteOffModule,
  'fin-asset-disposal':        AssetDisposalModule,
  'fin-purchase-discount':     PurchaseDiscountModule,

  // HR · Phase B — Employee Loans Module
  'hr-employee-loans':         EmployeeLoansModule,

  // Warehouse · Phase B — Inventory Adjustments
  'wh-inventory-adjustments':  InventoryScrapModule,

  // Management · System Administration
  'mgmt-backup-restore':       BackupRestoreModule,

  // Session 13 — SLA Dashboard, Management Tools, Smart Warehouse
  // Phase 3.3A Batch 2: maklon-sla-dashboard konsolidasi ke maklon-dashboard sebagai tab
  'maklon-sla-dashboard':  makeRedirect('maklon-dashboard', 'sla'),  // DEPRECATED → redirect ke maklon-dashboard tab SLA
  'mgmt-tools':            ManagementToolsModule,
  'warehouse-smart':       WarehouseSmartModule,

  // Session 14 — AI Business Intelligence
  'ai-business-dashboard': AIBusinessDashboard,  // Direct access masih bekerja (redirect dari sidebar dihapus DA46)

  // Phase 21 — Decision Support & Quality Metrics
  'prod-defect-codes':     RahazaDefectCodesModule,
  'prod-pareto':           RahazaParetoModule,

  // Phase 7: Marketing AR Bridge & Admin Setup
  'marketing-ar-bridge': MarketingARBridgeModule,
  'admin-setup-panel': AdminSetupPanelModule,

  'prod-fpy':              RahazaFPYModule,
  'prod-downtime':              RahazaDowntimeModule,
  'prod-backlog':               RahazaBacklogModule,
  'fin-procurement-requests': ProcurementRequestModule,    // P1.C — Procure-to-Pay PR Flow
  'procurement-requests':     ProcurementRequestModule,    // alias
  'prod-capacity-planning':     CapacityPlanningModule,   // Phase 2 — Capacity Planning Lite

  // Phase 20C — AI Insights
  'prod-ai-insights':      RahazaAIModule,
  'hr-ai-insights':        RahazaAIModule,

  // Session 15 — HR AI Extensions
  'hr-resume-screening':   HRResumeScreeningModule,
  'hr-attrition':          HRAttritionModule,
  'hr-coaching':           HRCoachingModule,

  // Session 17 — HR/SDM Features
  'hr-shift-scheduler':    ShiftSchedulerModule,
  'hr-job-board':          JobBoardModule,
  
  // Session 18 — P2-20 Skill Gap Analysis
  'hr-skill-gap':          HRSkillGapModule,
  
  // Session 18 — P2-3 OKR Tracker, P2-7 Predictive Maintenance, P2-19 Maklon AI Quote
  'mgmt-okr':              OKRTrackerModule,
  'prod-predictive-maintenance': PredictiveMaintenanceModule,
  'maklon-ai-quote':       MaklonAIQuoteModule,
  
  // Session 19 — E-3 AI Usage Monitor
  'ai-usage-monitor':      AIUsageMonitorModule,
  
  // Phase 3.3B — Unified Approval Hub (Aggregator Dashboard)
  'unified-approval-hub':  UnifiedApprovalHub,
  
  // Session 17 — Portal Saya AI Features
  'portal-career-coach':   CareerCoachModule,

  // Staff Self-Service Portal
  'self-dashboard':        SelfServicePortal,

  // Portal Saya — Self-Service HR + My Workspace
  'portal-dashboard':      PortalSayaDashboard,
  'portal-profile':        PortalSayaProfile,
  'portal-cuti':           PortalSayaCuti,
  'portal-payslip':        PortalSayaPayslip,
  'portal-training':       PortalSayaTraining,
  'portal-notifikasi':     PortalSayaNotifikasi,
  'portal-workspace':      WorkspaceHub,
  
  // Session 15 — Portal Saya Extensions
  'portal-documents':      MyDocumentsModule,
  'portal-annual-review':  MyAnnualReviewModule,
  'portal-peer-feedback':  PeerFeedbackModule,

  // Phase 22B — Shift Handover, Material Reservation, Production Calendar
  'prod-shift-handover':       RahazaShiftHandoverModule,
  'prod-material-reservation': RahazaMaterialReservationModule,
  'prod-production-calendar':  RahazaProductionCalendarModule,
  // Sprint 27 — AQL Sampling Calculator
  'prod-aql-calculator':       RahazaAQLCalculatorModule,

  // ─── Navigation Refinement Phase 1 — New Combined Modules ───────────────
  // Task 1.3: Model + BOM + Sizes combined
  'prod-models-bom':       RahazaModelsAndBOMModule,
  // Task 2 (Sistem): API Key management
  'mgmt-integrations':     IntegrationSettingsModule,

  // ─── Production Automation (Phase 4) ──────────────────────────────────────
  // Production Wizard (P0) - gabung Order → WO → Release → Bundles
  'prod-wizard':           ProductionWizardModule,

  // ─── Portal Maklon (Fase 3) ───────────────────────────────────────────────
  'maklon-dashboard': MaklonDashboard,
  'maklon-clients':   MaklonClientManagement,
  // 'maklon-orders' removed (Phase C 2026-05-23) — redirects below alias to maklon-po
  // Fase 3B: Sample & QC
  'maklon-samples':   MaklonSampleManagement,
  'maklon-qc':        MaklonQCTracking,
  'maklon-tracking':  MaklonProductionTracking,
  // Fase 3C: Billing & HPP + System Config
  'maklon-billing':   MaklonBillingModule,
  'maklon-hpp':       MaklonHppModule,
  'maklon-config':    MaklonSystemConfigModule,
  // Phase 4 P1: Notification Center
  'maklon-notifications': NotificationCenterModule,

  // ── Production-Maklon Overhaul — New Modules ────────────────────────────
  'maklon-po':          MaklonPOModule,        // PO+Seri CRUD + multi-dispatch (NEW)
  'maklon-po-360':      MaklonPO360Module,     // Unified 360° view per PO (Phase 25)
  'cmt-progress':       CMTProgressModule,     // CMT Progress + DO (NEW)
  'cmt-lifecycle':      CMTLifecycleModule,    // Phase 29 — Vendor-centric lifecycle dashboard
  
  // Session #11.21 — Vendor CMT Portal (2026-05-27)
  'vendor-portal':      VendorPortalModule,         // Vendor self-service: view jobs + submit progress
  'vendor-admin':       VendorAccountsAdminModule,  // Admin: kelola vendor partners + accounts + jobs

  // ─── Portal Marketing (eks-Toko Online — Rebrand in-place) ────────────────
  // Marketing Phase 1+2+3: Multi-account dashboard, Sales data, Task Management
  'toko-dashboard':         MarketingDashboard,        // SSOT: Marketing Dashboard (Phase 1+2+3)
  // Phase 3.3A: toko-dashboard-legacy & toko-dashboard-classic → redirect ke SSOT
  // makeRedirect digunakan agar deep-link lama tetap aman
  'toko-dashboard-legacy':  makeRedirect('toko-dashboard'),   // DEPRECATED → redirect ke toko-dashboard
  'toko-dashboard-classic': makeRedirect('toko-dashboard'),   // DEPRECATED → redirect ke toko-dashboard
  'marketing-accounts':     AccountManagementModule,   // NEW Phase 1
  'marketing-sales':        SalesDataEntryModule,      // NEW Phase 2
  'marketing-import':       ImportCenterModule,        // Phase 1 Universal Smart Import Engine
  'marketing-kol':          KOLCreatorModule,           // KOL Management
  'marketing-catalog':      CatalogManagementModule,   // Phase 5 Catalog Management
  'marketing-tasks':        TaskManagementModule,      // NEW Phase 3 — Kanban
  'marketing-approvals':    ApprovalInboxModule,       // NEW Phase 3 — Approval Inbox
  'marketing-templates':    TaskTemplatesModule,       // NEW Phase 3 — Templates
  // Consolidation #10: Task Hub (replaces 3 entries above in sidebar)
  'marketing-task-hub':     MarketingTaskHubModule,    // Hub: Kanban + Approval + Templates
  // Phase 2 Week 4-5: Orders & Complaints
  'marketing-orders':       UnifiedOrdersDashboard,    // NEW Phase 2 Week 4 — Unified Orders Dashboard
  'marketing-complaints':   ComplaintsManagementModule,// NEW Phase 2 Week 5 — Complaints Management (standalone deeplink)
  // Consolidation #9: After Sales Hub (replaces marketing-complaints + marketing-returns in sidebar)
  'marketing-after-sales':  MarketingAfterSalesHub,   // Hub: Komplain + Returns + Resolution Log
  // Phase 3 Week 6-7: Account Health, Sales Performance, Ads, Live
  'marketing-health':       AccountHealthDashboard,     // NEW Phase 3 Week 6 — Account Health Dashboard
  'marketing-performance':  SalesPerformanceDashboard,  // deeplink backward compat
  'marketing-ads':          AdsPerformanceDashboard,    // deeplink backward compat
  'marketing-live':         LiveSessionModule,          // NEW Phase 3 Week 7 — Live Session Module
  // Phase 3 Week 8-10: Content Calendar, Discount, Product Launch
  'marketing-content-calendar': ContentCalendarModule,  // Phase 3 Week 8
  'marketing-discounts':        DiscountCampaignModule, // Phase 3 Week 9
  'marketing-product-launches': ProductLaunchModule,    // Phase 3 Week 10
  // Phase 3 Week 11-12: Overview + Integration Settings
  'marketing-overview':              MarketingOverviewDashboard,    // deeplink backward compat
  // Consolidation #8: Marketing Reports Hub (replaces 5 entries in sidebar)
  'marketing-reports':               MarketingReportsHub,
  'marketing-integration-settings':  MarketingIntegrationSettings, // Phase 3 Week 12
  'marketing-webhooks':              MarketingWebhooksModule,      // Phase 1/2 — Webhook Events Monitor
  'marketing-live-analytics':        LiveSessionAnalyticsDashboard, // Phase 3 — Live Session Analytics
  'marketing-ai-insights':           MarketingAIInsightsDashboard, // Gap 2 — AI Insights Dashboard
  'marketing-advanced-ai':           AdvancedAIModule,             // Phase 5 — Advanced AI (Dynamic Pricing, Churn, A/B)
  // Session 12 — P1-4, P1-5, P1-8, P1-6/7
  'marketing-ai-content':            AIContentGeneratorModule,
  'marketing-ai-image':              AIImageGeneratorModule,
  'marketing-kol-leaderboard':       KOLLeaderboardModule,
  'marketing-scheduler':             MarketingSchedulerModule,
  // Phase 3 Week 13: Fitur Internal
  'marketing-reviews':   RatingReviewModule,      // Phase 3 Week 13 — Rating & Review Management
  'marketing-returns':   ReturnsRefundsModule,    // Phase 3 Week 13 — Returns & Refunds Tracking
  'marketing-samples':   SampleDeliveryModule,    // Phase 3 Week 13 — Sample Delivery Tracking
  'marketing-livehost':  LiveHostModule,          // Session 28 — LiveHost Management (Phase 1-4)
  'marketing-targets':   AccountTargetsModule,    // Session 28 — Monthly Target per Akun
  'marketing-daily-report':   DailyReportModule,   // deeplink backward compat
  'marketing-monthly-report': MonthlyReportModule, // deeplink backward compat

  // Existing Toko Online (legacy operasional marketplace)
  'toko-products':  TokoProductCatalogModule,
  'toko-channels':  TokoChannelManagerModule,
  // Phase 5B: Orders (dengan tab variant)
  'toko-orders':    makeModuleWithTab(TokoOrdersModule, 'orders'),
  'toko-packing':   makeModuleWithTab(TokoOrdersModule, 'packing'),
  'toko-shipping':  makeModuleWithTab(TokoOrdersModule, 'shipping'),
  // Phase 6: Fulfillment (Online Order Bridge: Marketing → Inventory)
  'fulfillment':    FulfillmentModule,
  // Phase 2 Enhancement: DO Management + Unified Inventory Viewer
  'do-management':      DOManagementModule,
  'unified-inventory':  UnifiedInventoryModule,
  // Phase 7 — Laporan & Dashboard
  'phase7-reports':     Phase7ReportingModule,
  // Phase 5B: Pricing & Flashsale
  'toko-pricing':   TokoPricingFlashsaleModule,
  // Phase 5B: KOL Management — REMOVED in Session #11.17 (post Phase C+D).
  // Use marketing-kol (SSOT) and marketing-kol-leaderboard from Marketing portal.
  // Phase 5B: Customer Service & Returns
  'toko-cs':        makeModuleWithTab(TokoCSReturnsModule, 'cs'),
  'toko-returns':   makeModuleWithTab(TokoCSReturnsModule, 'returns'),

  // ─── Fase 2: Cutting & CMT ────────────────────────────────────────────────
  'prod-cutting': CuttingHubModule, // P2 Consolidation #2 (Session #11 cont.) — was CuttingProcessModule
  'prod-cmt':     CMTManagementModule,
  'prod-cmt-packing': CMTPackingModule,
  'prod-material-returns': ProductionMaterialReturnsModule,  // Task 2.5 — Production Material Returns

  // ─── Phase 6 — HRIS (Full) ────────────────────────────────────────────────
  'hr-performance': HRPerformanceModule,     // deeplink backward compat
  'hr-kpi':         HRKPIModule,             // deeplink backward compat
  'hr-lms':         HRLMSModule,
  'hr-onboarding':  HROnboardingModule,
  'hr-recruitment': HRATSModule,
  'hr-org-chart':   HROrgChartModule,
  'kpi-portal': KPIPortalModule,
  'hr-assets': HRAssetModule,
  'hr-payroll-allowances': RahazaPayrollAllowancesModule,
  // Sprint 42 — Salary Adjustment with Dual Approval (Manager + HR)
  'hr-salary-adjustments': RahazaSalaryAdjustmentModule,
  'ai-actions': AIActionsModule,
  'wh-picklist': WMSPickListModule,
  // WMS P0/P1 Garment Features
  'wms-fabric-rolls':    WMSFabricRollsModule,
  'wms-delivery-notes':  WMSDeliveryNotesModule,
  'wms-cmt-dispatches':  WMSCMTDispatchesModule,
  'wms-opname-enhanced': WMSOpnameEnhancedModule,

  // ─── Phase 7 — RnD & Style Master ─────────────────────────────────────────
  'rnd-module': RnDModule,

  // ─── Session 26 — Portal RnD (dedicated portal modules, 2026-05-15) ────────
  'rnd-dashboard':  RnDPortalDashboard,
  'rnd-styles':     RnDStylesTab,
  'rnd-variants':   RnDVariantModule,
  'rnd-samples':    RnDSamplesTab,
  'rnd-revisions':  RnDRevisionsTab,
  'rnd-materials':  RnDMaterialsTab,
  'rnd-patterns':   RnDPatternModule,
  'rnd-costing':    RnDCostingTab,
  'rnd-hpp':        RnDHPPCalculatorModule,
  'rnd-analytics':  RnDAnalyticsModule,
  // Session 27 — RnD Enhancement: Tech Pack Management + Style Detail View
  'rnd-techpack':   RnDTechPackModule,
  'rnd-style-detail': RnDStyleDetailPage,  // Modal/Side panel, tidak untuk routing langsung

  // ─── Session 27 — GAP P0 SOP (KREATOR Requests, Accessory Inbox, CMT Shortage) ───
  'marketing-kreator-requests':       KREATORRequestModule,
  'rnd-kreator-requests':             KREATORRequestModule,  // alias agar bisa diakses dari Portal RnD
  'warehouse-accessory-requests':     AccessoryRequestInbox,
  'rnd-accessory-requests':           AccessoryRequestInbox,  // alias untuk RnD self-monitor
  'production-cmt-component-requests': CMTComponentRequestModule,
  'cmt-component-requests':           CMTComponentRequestModule,  // alias generic

  // ─── New Portals: Collaboration (Communication + Workspace + Learning) + Asset Management ───────────────────
  'collaboration':            lazy(() => import('./CollaborationPortal')),
  'collab-workspace':         lazy(() => import('./WorkspacePortal')),  // Spreadsheet Workspace
  'collab-communication':     lazy(() => import('./CommunicationHubPortal')),  // Direct access
  'asset-dashboard':          lazy(() => import('./AssetManagementPortal')),
  'asset-list':               lazy(() => import('./AssetManagementPortal')),
  'asset-procurement':        lazy(() => import('./AssetManagementPortal')),

  // ─── Portal Aksesoris — MVP (Session #11.21) ──────────────────────────────
  'accessories-dashboard':        AccessoriesDashboard,
  'accessories-master-stock':     makeModuleWithTab(AccessoryModule, 'master'),
  'accessories-opname':           makeModuleWithTab(AccessoryModule, 'opname'),
  'accessories-internal-request': makeModuleWithTab(AccessoryModule, 'internal'),
  'accessories-inbox':            AccessoryRequestInbox,
  'accessories-loans':            makeModuleWithTab(AccessoryModule, 'pinjam'),
  'accessories-purchase':         makeModuleWithTab(AccessoryModule, 'pr'),
  'accessories-reports':          AccessoriesReports,

  // ─── Redirect stubs — backwards compatibility ──────────────────────────
  // P0 FIX: Maklon legacy items moved to Production portal
  // maklon-orders → maklon-po (new PO system)
  'maklon-orders':           makeRedirect('maklon-po'),
  // maklon-cmt and maklon-packing belong in Production portal (CMT is outsourcing, part of production)
  'maklon-cmt':              makeRedirect('prod-cmt'),
  'maklon-packing':          makeRedirect('prod-cmt-packing'),
  // Task 1.1: mgmt-products → prod-models-bom
  'mgmt-products':           makeRedirect('prod-models-bom', 'models'),
  // Task 1.1: wh-material-reservation → prod-material-reservation
  'wh-material-reservation': makeRedirect('prod-material-reservation'),
  // Task 1.2: old individual dashboard modules → production-dashboard (with tab hint)
  'prod-oee':                makeRedirect('production-dashboard', 'performance'),
  'prod-line-balance':       makeRedirect('production-dashboard', 'performance'),
  'prod-rework-analytics':   makeRedirect('production-dashboard', 'quality'),
  'prod-aps-gantt':          makeRedirect('production-dashboard', 'schedule'),
  // Task 1.3: old individual model/bom/sizes → prod-models-bom (with tab hint)
  'prod-models':             makeRedirect('prod-models-bom', 'models'),
  'prod-bom':                makeRedirect('prod-models-bom', 'bom'),
  'prod-sizes':              makeRedirect('prod-models-bom', 'sizes'),
};

export const DEFAULT_MODULE = ManagementDashboard;
