/**
 * MarketingReportsHub.jsx
 * Consolidation #8: Marketing Reports — Overview + Sales + Ads + Harian + Bulanan
 * Replaces: marketing-overview + marketing-performance + marketing-ads
 *           + marketing-daily-report + marketing-monthly-report (5 entries → 1)
 * Effort: 12h | Risk: Low
 */
import React, { useState } from 'react';
import {
  LayoutDashboard, BarChart3, MousePointer,
  CalendarCheck, Calendar
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import MarketingOverviewDashboard  from './marketing/MarketingOverviewDashboard';
import SalesPerformanceDashboard   from './marketing/SalesPerformanceDashboard';
import AdsPerformanceDashboard     from './marketing/AdsPerformanceDashboard';
import DailyReportModule           from './marketing/DailyReportModule';
import MonthlyReportModule         from './marketing/MonthlyReportModule';

export default function MarketingReportsHub({ token, onNavigate }) {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="h-full" data-testid="marketing-reports-hub">
      {/* Hub Header */}
      <div className="px-4 md:px-6 py-4 border-b bg-background">
        <h1 className="text-xl font-bold tracking-tight">Laporan & Analytics Marketing</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Overview eksekutif, performa penjualan, iklan, laporan harian &amp; bulanan PIC
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
        <div className="px-4 md:px-6 pt-4 border-b bg-background">
          <TabsList className="h-9 flex-wrap">
            <TabsTrigger value="overview" className="gap-1.5" data-testid="tab-overview">
              <LayoutDashboard size={13} />
              Overview
            </TabsTrigger>
            <TabsTrigger value="sales" className="gap-1.5" data-testid="tab-sales-perf">
              <BarChart3 size={13} />
              Sales Performa
            </TabsTrigger>
            <TabsTrigger value="ads" className="gap-1.5" data-testid="tab-ads-perf">
              <MousePointer size={13} />
              Ads Performa
            </TabsTrigger>
            <TabsTrigger value="daily" className="gap-1.5" data-testid="tab-daily-report">
              <CalendarCheck size={13} />
              Laporan Harian
            </TabsTrigger>
            <TabsTrigger value="monthly" className="gap-1.5" data-testid="tab-monthly-report">
              <Calendar size={13} />
              Laporan Bulanan
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="flex-1 overflow-auto m-0">
          <MarketingOverviewDashboard token={token} onNavigate={onNavigate} />
        </TabsContent>
        <TabsContent value="sales" className="flex-1 overflow-auto m-0">
          <SalesPerformanceDashboard token={token} />
        </TabsContent>
        <TabsContent value="ads" className="flex-1 overflow-auto m-0">
          <AdsPerformanceDashboard token={token} />
        </TabsContent>
        <TabsContent value="daily" className="flex-1 overflow-auto m-0 p-4 md:p-6">
          <DailyReportModule token={token} />
        </TabsContent>
        <TabsContent value="monthly" className="flex-1 overflow-auto m-0 p-4 md:p-6">
          <MonthlyReportModule token={token} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
