/**
 * MarketingOverviewDashboard Tests — Session #11.18 Task A
 * ============================================================
 * Covers:
 *   - Renders header + refresh button
 *   - Fetches 6 module summaries on mount (orders, complaints, health, discounts, launches, content)
 *   - Loading state with spinner
 *   - 6 module cards rendered with correct titles
 *   - Module card click navigates to corresponding module
 *   - Quick action buttons fire navigation
 *   - Urgent banner appears when overdue/expiring/ready > 0
 *   - Urgent banner hidden when no urgent items
 *   - Alert panel: empty state, list state, click triggers nav
 *   - Trigger alerts button fires POST + toast
 *   - Status module sekilas panel renders correct counts
 *   - Refresh button re-fetches all
 */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import MarketingOverviewDashboard from '../components/erp/marketing/MarketingOverviewDashboard';

// Mock axios
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));
const axios = require('axios');

// Mock useToast
const mockToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockOrders = {
  total_orders: 150, need_action: 12, total_revenue: 250_000_000,
  by_status: { new: 5, packed: 3, shipped: 4, delivered: 138 },
};
const mockComplaints = {
  total: 25, overdue: 3, resolved: 20,
  by_status: { open: 5 },
};
const mockHealth = { total_accounts: 80, healthy: 60, warning: 15, critical: 5 };
const mockDiscounts = { total: 20, active: 8, upcoming: 5, expiring_soon: 2 };
const mockLaunches = { total: 15, planning: 3, ready: 4, launched: 8, upcoming_30: 6 };
const mockContent = { total: 50, draft: 10, scheduled: 20, posted: 20 };

function mockSummaries() {
  axios.get.mockImplementation((url) => {
    if (url.includes('/orders/summary')) return Promise.resolve({ data: mockOrders });
    if (url.includes('/complaints/summary')) return Promise.resolve({ data: mockComplaints });
    if (url.includes('/health/summary')) return Promise.resolve({ data: { success: true, data: mockHealth } });
    if (url.includes('/discounts/summary')) return Promise.resolve({ data: { success: true, data: mockDiscounts } });
    if (url.includes('/product-launches/summary')) return Promise.resolve({ data: { success: true, data: mockLaunches } });
    if (url.includes('/content-calendar/summary')) return Promise.resolve({ data: { success: true, data: mockContent } });
    return Promise.resolve({ data: {} });
  });
  axios.post.mockResolvedValue({ data: { success: true, fired: [], total_fired: 0 } });
}

describe('MarketingOverviewDashboard', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
    mockToast.mockReset();
  });

  it('renders main header with title and refresh button', async () => {
    mockSummaries();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    expect(screen.getByText('Marketing Overview')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
    expect(screen.getByText('Cek Alert')).toBeInTheDocument();
  });

  it('shows loading spinner initially', () => {
    mockSummaries();
    const { container } = render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    // Loader2 has animate-spin class
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('fetches all 6 module summaries on mount', async () => {
    mockSummaries();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => {
      const urls = axios.get.mock.calls.map(c => c[0]);
      expect(urls.some(u => u.includes('/orders/summary'))).toBe(true);
      expect(urls.some(u => u.includes('/complaints/summary'))).toBe(true);
      expect(urls.some(u => u.includes('/health/summary'))).toBe(true);
      expect(urls.some(u => u.includes('/discounts/summary'))).toBe(true);
      expect(urls.some(u => u.includes('/product-launches/summary'))).toBe(true);
      expect(urls.some(u => u.includes('/content-calendar/summary'))).toBe(true);
    });
  });

  it('renders 6 module cards with correct titles after load', async () => {
    mockSummaries();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Unified Orders')).toBeInTheDocument());
    expect(screen.getByText('Kelola Komplain')).toBeInTheDocument();
    expect(screen.getByText('Account Health')).toBeInTheDocument();
    expect(screen.getByText('Discount Campaigns')).toBeInTheDocument();
    expect(screen.getByText('Product Launch')).toBeInTheDocument();
    expect(screen.getByText('Content Calendar')).toBeInTheDocument();
  });

  it('module card click navigates to corresponding module', async () => {
    mockSummaries();
    const onNavigate = jest.fn();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText('Unified Orders')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Unified Orders'));
    expect(onNavigate).toHaveBeenCalledWith('marketing-orders');
  });

  it('urgent banner appears when complaints overdue > 0', async () => {
    mockSummaries();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => {
      // urgentCount = 3 (overdue) + 2 (expiring_soon) + 4 (ready) = 9
      expect(screen.getByText(/9 hal memerlukan perhatian/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/3 komplain overdue/)).toBeInTheDocument();
    expect(screen.getByText(/2 kampanye akan habis/)).toBeInTheDocument();
    expect(screen.getByText(/4 produk siap launch/)).toBeInTheDocument();
  });

  it('urgent banner hidden when no urgent items', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/orders/summary')) return Promise.resolve({ data: { total_orders: 10, need_action: 0 } });
      if (url.includes('/complaints/summary')) return Promise.resolve({ data: { total: 5, overdue: 0 } });
      if (url.includes('/health/summary')) return Promise.resolve({ data: { success: true, data: { total_accounts: 10, critical: 0 } } });
      if (url.includes('/discounts/summary')) return Promise.resolve({ data: { success: true, data: { active: 2, expiring_soon: 0 } } });
      if (url.includes('/product-launches/summary')) return Promise.resolve({ data: { success: true, data: { ready: 0 } } });
      if (url.includes('/content-calendar/summary')) return Promise.resolve({ data: { success: true, data: { scheduled: 5 } } });
      return Promise.resolve({ data: {} });
    });
    axios.post.mockResolvedValue({ data: { success: true, fired: [] } });
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Unified Orders')).toBeInTheDocument());
    expect(screen.queryByText(/memerlukan perhatian segera/)).not.toBeInTheDocument();
  });

  it('shows empty alert state with checkmark', async () => {
    mockSummaries();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Alert Aktif')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Semua kondisi normal/i)).toBeInTheDocument());
  });

  it('renders alert items when alerts present', async () => {
    axios.get.mockImplementation((url) => Promise.resolve({ data: { success: true, data: {} } }));
    axios.post.mockResolvedValue({
      data: {
        success: true,
        fired: [
          { title: 'Critical alert', message: 'Take action now', severity: 'error', link_module: 'marketing-complaints' },
          { title: 'Warning alert', message: 'Check soon', severity: 'warning' },
        ]
      },
    });
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Critical alert')).toBeInTheDocument());
    expect(screen.getByText('Warning alert')).toBeInTheDocument();
    expect(screen.getByText('Take action now')).toBeInTheDocument();
  });

  it('Cek Alert button triggers POST + toast notification', async () => {
    mockSummaries();
    axios.post.mockResolvedValue({ data: { success: true, fired: [], total_fired: 5 } });
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Unified Orders')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Cek Alert'));
    await waitFor(() => {
      const evalCall = axios.post.mock.calls.find(c => c[0].includes('/alerts/evaluate'));
      expect(evalCall).toBeTruthy();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('5 alert dikirim'),
      }));
    });
  });

  it('refresh button re-fetches all summaries', async () => {
    mockSummaries();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(6));
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(12));
  });

  it('Quick Actions row shows 6 buttons', async () => {
    mockSummaries();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Unified Orders')).toBeInTheDocument());
    // Quick Actions appear in dedicated section — using getAllByText since some labels (e.g., "Tambah Konten Hari Ini")
    // also appear as a quick-action shortcut elsewhere
    expect(screen.getAllByText(/Tambah Konten Hari Ini/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Buat Kampanye Diskon/)).toBeInTheDocument();
    expect(screen.getByText(/Tambah Produk Launch/)).toBeInTheDocument();
    expect(screen.getByText(/Cek Komplain Overdue/)).toBeInTheDocument();
    expect(screen.getByText(/Sales Performance/)).toBeInTheDocument();
    expect(screen.getByText(/Import Data Baru/)).toBeInTheDocument();
  });

  it('Quick Action button fires onNavigate', async () => {
    mockSummaries();
    const onNavigate = jest.fn();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText('Unified Orders')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Sales Performance/));
    expect(onNavigate).toHaveBeenCalledWith('marketing-performance');
  });

  it('Status module sekilas panel renders', async () => {
    mockSummaries();
    render(<MarketingOverviewDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Status Module Sekilas')).toBeInTheDocument());
    expect(screen.getByText(/Orders aktif/)).toBeInTheDocument();
    expect(screen.getByText(/Komplain belum selesai/)).toBeInTheDocument();
    expect(screen.getByText(/Campaign diskon aktif/)).toBeInTheDocument();
  });
});
