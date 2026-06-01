/**
 * ProductionDashboardModule Tests — Session #11.18 Task A
 * ============================================================
 * Covers:
 *   - Renders 5 tabs (Overview, Performance, Quality, Schedule, AI)
 *   - Default active tab = "overview"
 *   - Tab switching via sessionStorage deep-link
 *   - sessionStorage cleanup after consumption
 *   - Invalid sessionStorage value falls back to overview
 *   - Each tab content renders correct mocked module
 *   - Passes correct props (token, user, headers) to child modules
 */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import ProductionDashboardModule from '../components/erp/ProductionDashboardModule';

// Mock all heavy child modules
jest.mock('../components/erp/ProductionDashboardOverview', () => ({ token }) => (
  <div data-testid="overview-mock">Overview content (token: {token || 'no-token'})</div>
));
jest.mock('../components/erp/RahazaOEEModule', () => ({ headers }) => (
  <div data-testid="oee-mock">OEE Module (headers: {headers ? 'yes' : 'no'})</div>
));
jest.mock('../components/erp/RahazaLineBalancingModule', () => () => (
  <div data-testid="line-balancing-mock">Line Balancing</div>
));
jest.mock('../components/erp/ReworkAnalyticsModule', () => () => (
  <div data-testid="rework-mock">Rework Analytics</div>
));
jest.mock('../components/erp/APSGanttModule', () => () => (
  <div data-testid="aps-gantt-mock">APS Gantt</div>
));
jest.mock('../components/erp/AIInsightsModule', () => ({ token }) => (
  <div data-testid="ai-insights-mock">AI Insights (token: {token || 'no-token'})</div>
));

describe('ProductionDashboardModule', () => {
  const baseProps = {
    token: 'tok-123',
    user: { name: 'Admin', role: 'superadmin' },
    headers: { Authorization: 'Bearer tok-123' },
    userRole: 'superadmin',
    hasPerm: () => true,
    onNavigate: jest.fn(),
    moduleId: 'production-dashboard',
  };

  beforeEach(() => {
    sessionStorage.clear();
    baseProps.onNavigate.mockClear();
  });

  it('renders dashboard with all 5 tabs', () => {
    render(<ProductionDashboardModule {...baseProps} />);
    expect(screen.getByTestId('production-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('tab-performance')).toBeInTheDocument();
    expect(screen.getByTestId('tab-quality')).toBeInTheDocument();
    expect(screen.getByTestId('tab-schedule')).toBeInTheDocument();
    expect(screen.getByTestId('tab-ai')).toBeInTheDocument();
  });

  it('shows main header with title and description', () => {
    render(<ProductionDashboardModule {...baseProps} />);
    expect(screen.getByText('Dashboard Produksi')).toBeInTheDocument();
    expect(screen.getByText(/Monitoring real-time WIP/i)).toBeInTheDocument();
  });

  it('default active tab is "overview"', async () => {
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('overview-mock')).toBeInTheDocument());
    // Verify active state via data attribute
    expect(screen.getByTestId('tab-overview')).toHaveAttribute('data-state', 'active');
  });

  it('overview tab is active by default — performance/others inactive', () => {
    render(<ProductionDashboardModule {...baseProps} />);
    expect(screen.getByTestId('tab-overview')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('tab-performance')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByTestId('tab-quality')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByTestId('tab-schedule')).toHaveAttribute('data-state', 'inactive');
    expect(screen.getByTestId('tab-ai')).toHaveAttribute('data-state', 'inactive');
  });

  it('deep-links to performance tab via sessionStorage', async () => {
    sessionStorage.setItem('prod_dashboard_tab', 'performance');
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('oee-mock')).toBeInTheDocument());
    expect(screen.getByTestId('line-balancing-mock')).toBeInTheDocument();
    expect(screen.getByTestId('tab-performance')).toHaveAttribute('data-state', 'active');
  });

  it('deep-links to quality tab via sessionStorage', async () => {
    sessionStorage.setItem('prod_dashboard_tab', 'quality');
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('rework-mock')).toBeInTheDocument());
    expect(screen.getByTestId('tab-quality')).toHaveAttribute('data-state', 'active');
  });

  it('deep-links to schedule tab via sessionStorage', async () => {
    sessionStorage.setItem('prod_dashboard_tab', 'schedule');
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('aps-gantt-mock')).toBeInTheDocument());
    expect(screen.getByTestId('tab-schedule')).toHaveAttribute('data-state', 'active');
  });

  it('deep-links to ai tab via sessionStorage', async () => {
    sessionStorage.setItem('prod_dashboard_tab', 'ai');
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('ai-insights-mock')).toBeInTheDocument());
    expect(screen.getByTestId('tab-ai')).toHaveAttribute('data-state', 'active');
  });

  it('clears sessionStorage after consuming deep-link', async () => {
    sessionStorage.setItem('prod_dashboard_tab', 'quality');
    render(<ProductionDashboardModule {...baseProps} />);
    expect(sessionStorage.getItem('prod_dashboard_tab')).toBeNull();
  });

  it('ignores invalid sessionStorage value (falls back to overview)', async () => {
    sessionStorage.setItem('prod_dashboard_tab', 'invalid-tab');
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('overview-mock')).toBeInTheDocument());
    expect(screen.getByTestId('tab-overview')).toHaveAttribute('data-state', 'active');
  });

  it('passes token prop to Overview tab child', async () => {
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('overview-mock')).toHaveTextContent('token: tok-123');
    });
  });

  it('passes headers prop to Performance tab children via deep-link', async () => {
    sessionStorage.setItem('prod_dashboard_tab', 'performance');
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('oee-mock')).toHaveTextContent('headers: yes');
    });
  });

  it('passes token to AI Insights via deep-link', async () => {
    sessionStorage.setItem('prod_dashboard_tab', 'ai');
    render(<ProductionDashboardModule {...baseProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-insights-mock')).toHaveTextContent('token: tok-123');
    });
  });
});
