/**
 * CuttingHubModule \u2014 P2 Consolidation #2 (Session #11 cont.)
 *
 * Merges 2 previously separate sidebar entries into 1 unified hub with tabs:
 *   - Tab "Planning":    embeds CuttingProcessModule (cutting requests + batches mgmt)
 *   - Tab "Execution":   embeds ProcessExecutionModule with processCode forced to CUTTING
 *
 * Before refactor (sidebar duplicates):
 *   - prod-cutting       \u2192 CuttingProcessModule         (planning side)
 *   - prod-exec-cutting  \u2192 ProcessExecutionModule       (execution side, CUTTING code)
 *
 * After refactor (single sidebar entry):
 *   - prod-cutting       \u2192 CuttingHubModule  (THIS FILE, with 2 tabs above)
 *   - prod-exec-cutting  \u2192 ProcessExecutionModule  (REMAINS for backward compat &
 *                                                  for other process codes; sidebar entry
 *                                                  is removed per FORENSIC_09 spec)
 *
 * Props (App.js): { token, user, headers, userRole, hasPerm, onNavigate, moduleId,
 *                   deepLinkParams }
 *
 * The Hub forwards relevant props to each tab\u2019s component. For Execution tab, we override
 * `moduleId` to `'prod-exec-cutting'` so ProcessExecutionModule\u2019s internal
 * `processCode = moduleId.replace('prod-exec-', '').toUpperCase()` resolves to `'CUTTING'`.
 *
 * URL/state lock-in: tab state is held in URL hash so a deep link like
 *   #prod-cutting=execution  preselects the Execution tab.
 */

import { useState, useEffect, lazy, Suspense } from 'react';
import { Scissors, Factory } from 'lucide-react';

// Lazy-load both sub-modules to keep the hub light and preserve code-splitting
const CuttingProcessModule = lazy(() => import('./CuttingProcessModule'));
const ProcessExecutionModule = lazy(() => import('./ProcessExecutionModule'));

const TABS = [
  {
    id: 'planning',
    label: 'Planning',
    icon: Scissors,
    desc: 'Cutting Requests, Approval & Batch Management',
  },
  {
    id: 'execution',
    label: 'Execution',
    icon: Factory,
    desc: 'Real-time Cutting Line Output (CUTTING)',
  },
];

function TabPlaceholder({ label }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <div className="h-2 w-24 rounded bg-foreground/10 animate-pulse" />
      <p className="text-xs">Memuat {label}\u2026</p>
    </div>
  );
}

export default function CuttingHubModule({
  token,
  user,
  headers,
  userRole,
  hasPerm,
  onNavigate,
  moduleId, // expected: 'prod-cutting'
  deepLinkParams,
}) {
  // Restore tab from URL hash if present, otherwise default to "planning"
  const [activeTab, setActiveTab] = useState(() => {
    const h = typeof window !== 'undefined' ? window.location.hash : '';
    if (h.includes('=execution')) return 'execution';
    if (deepLinkParams?.tab === 'execution') return 'execution';
    return 'planning';
  });

  // Sync URL hash so deep links work and back-button respects tab
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = `#prod-cutting=${activeTab}`;
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [activeTab]);

  const activeMeta = TABS.find((t) => t.id === activeTab) || TABS[0];

  return (
    <div className="min-h-screen bg-background" data-testid="cutting-hub-module">
      {/* Hub Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Scissors className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Cutting Hub</h1>
          <span
            className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/15 text-primary border border-primary/25"
            title="Consolidated module (Session #11)"
          >
            HUB
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Planning &amp; Execution untuk proses Cutting dalam satu tempat — {activeMeta.desc}.
        </p>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 p-1 bg-muted rounded-xl mb-6 overflow-x-auto max-w-md"
        role="tablist"
        aria-label="Cutting Hub Tabs"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex-1 justify-center whitespace-nowrap ${
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              data-testid={`cutting-hub-tab-${tab.id}`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div data-testid={`cutting-hub-content-${activeTab}`}>
        {activeTab === 'planning' && (
          <Suspense fallback={<TabPlaceholder label="Planning" />}>
            <CuttingProcessModule
              token={token}
              user={user}
              headers={headers}
              userRole={userRole}
              hasPerm={hasPerm}
              onNavigate={(target, params) => {
                // Allow embedded module to switch to Execution tab via onNavigate('execution')
                if (target === 'execution' || target === 'cutting-execution') {
                  setActiveTab('execution');
                  return;
                }
                onNavigate?.(target, params);
              }}
              moduleId={moduleId}
              deepLinkParams={deepLinkParams}
            />
          </Suspense>
        )}

        {activeTab === 'execution' && (
          <Suspense fallback={<TabPlaceholder label="Execution" />}>
            <ProcessExecutionModule
              token={token}
              user={user}
              headers={headers}
              userRole={userRole}
              hasPerm={hasPerm}
              onNavigate={onNavigate}
              // CRITICAL: ProcessExecutionModule derives processCode from moduleId.
              // Force 'prod-exec-cutting' so it resolves to CUTTING regardless of the
              // hub's actual sidebar moduleId ('prod-cutting').
              moduleId="prod-exec-cutting"
              deepLinkParams={deepLinkParams}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
