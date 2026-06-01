/**
 * ProductionDashboardModule — Enhanced (Task 1.2)
 * Dashboard Produksi dengan 4 tab: Overview, Performance (OEE + Line Balance),
 * Quality (Rework Analytics), Schedule (APS Gantt).
 */
import { useState, useEffect, Suspense } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Gauge, Activity, Shield, CalendarClock, Brain } from 'lucide-react';
import ProductionDashboardOverview from './ProductionDashboardOverview';
import RahazaOEEModule from './RahazaOEEModule';
import RahazaLineBalancingModule from './RahazaLineBalancingModule';
import ReworkAnalyticsModule from './ReworkAnalyticsModule';
import APSGanttModule from './APSGanttModule';
import AIInsightsModule from './AIInsightsModule';

const TabSpinner = () => (
  <div className="flex items-center justify-center h-48">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[hsl(var(--primary))]" />
  </div>
);

export default function ProductionDashboardModule({ token, user, headers, userRole, hasPerm, onNavigate, moduleId }) {
  // Allow deep linking via sessionStorage
  const getInitialTab = () => {
    const stored = sessionStorage.getItem('prod_dashboard_tab');
    if (stored && ['overview', 'performance', 'quality', 'schedule', 'ai'].includes(stored)) {
      sessionStorage.removeItem('prod_dashboard_tab');
      return stored;
    }
    return 'overview';
  };

  const [activeTab, setActiveTab] = useState(getInitialTab);

  return (
    <div className="space-y-4" data-testid="production-dashboard">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard Produksi</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Monitoring real-time WIP, performa, kualitas, dan jadwal produksi.
            </p>
          </div>
          <TabsList className="grid grid-cols-5">
            <TabsTrigger value="overview" className="flex items-center gap-1.5" data-testid="tab-overview">
              <Gauge className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Overview</span>
            </TabsTrigger>
            <TabsTrigger value="performance" className="flex items-center gap-1.5" data-testid="tab-performance">
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Performa</span>
            </TabsTrigger>
            <TabsTrigger value="quality" className="flex items-center gap-1.5" data-testid="tab-quality">
              <Shield className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Kualitas</span>
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex items-center gap-1.5" data-testid="tab-schedule">
              <CalendarClock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Jadwal</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-1.5" data-testid="tab-ai">
              <Brain className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">AI Insight</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: Overview — WIP real-time */}
        <TabsContent value="overview" className="mt-4">
          <Suspense fallback={<TabSpinner />}>
            <ProductionDashboardOverview
              token={token}
              user={user}
              headers={headers}
              userRole={userRole}
              onNavigate={onNavigate}
            />
          </Suspense>
        </TabsContent>

        {/* Tab 2: Performance — OEE + Line Balancing */}
        <TabsContent value="performance" className="mt-4">
          <Suspense fallback={<TabSpinner />}>
            <div className="space-y-8">
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-4">OEE Dashboard</h2>
                <RahazaOEEModule
                  token={token}
                  user={user}
                  headers={headers}
                  userRole={userRole}
                  hasPerm={hasPerm}
                  onNavigate={onNavigate}
                />
              </div>
              <div className="border-t border-border pt-6">
                <h2 className="text-lg font-semibold text-foreground mb-4">Line Balancing</h2>
                <RahazaLineBalancingModule
                  token={token}
                  user={user}
                  headers={headers}
                  userRole={userRole}
                  hasPerm={hasPerm}
                  onNavigate={onNavigate}
                />
              </div>
            </div>
          </Suspense>
        </TabsContent>

        {/* Tab 3: Quality — Rework Analytics */}
        <TabsContent value="quality" className="mt-4">
          <Suspense fallback={<TabSpinner />}>
            <ReworkAnalyticsModule
              token={token}
              user={user}
              headers={headers}
              userRole={userRole}
              hasPerm={hasPerm}
              onNavigate={onNavigate}
            />
          </Suspense>
        </TabsContent>

        {/* Tab 4: Schedule — APS Gantt */}
        <TabsContent value="schedule" className="mt-4">
          <Suspense fallback={<TabSpinner />}>
            <APSGanttModule
              token={token}
              user={user}
              headers={headers}
              userRole={userRole}
              hasPerm={hasPerm}
              onNavigate={onNavigate}
            />
          </Suspense>
        </TabsContent>

        {/* Tab 5: AI Insight — Phase 8 Analytics & AI */}
        <TabsContent value="ai" className="mt-4">
          <Suspense fallback={<TabSpinner />}>
            <AIInsightsModule token={token} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
