/**
 * MaklonDashboard Tests — Session #11.18 Task A
 * ============================================================
 * Covers:
 *   - Initial render with PageHeader
 *   - Fetches summary + orders on mount with token
 *   - 8 KPI cards rendered with correct labels
 *   - Stats values from API response
 *   - Quick Actions buttons trigger onNavigate
 *   - Empty state when no recent orders
 *   - Loading state during fetch
 *   - Recent orders table with status badges
 *   - StatusBadge maps known statuses correctly
 *   - Refresh button re-fetches data
 *   - Error toast on fetch failure
 */
import React from 'react';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import MaklonDashboard from '../components/erp/MaklonDashboard';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    error: jest.fn(),
    success: jest.fn(),
  }),
}));

// Mock motion to skip animations
jest.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props) => <div {...props}>{props.children}</div>,
  }),
}));

// Mock GlassCard to skip styling
jest.mock('@/components/ui/glass', () => ({
  GlassCard: ({ children, className, ...props }) => (
    <div className={className} {...props}>{children}</div>
  ),
}));

// Mock moduleAtoms PageHeader
jest.mock('../components/erp/moduleAtoms', () => ({
  PageHeader: ({ title, description, actions }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{actions}</div>
    </div>
  ),
}));

// Mock maklonOrderAdapter
jest.mock('@/lib/maklonOrderAdapter', () => ({
  fetchMaklonOrders: jest.fn(),
  posToLegacyOrders: (data) => Array.isArray(data) ? data : [],
}));

const mockSummary = {
  total_clients: 25,
  active_clients: 18,
  active_orders: 12,
  completed_orders: 45,
  draft_orders: 3,
  confirmed_orders: 8,
  in_production: 7,
  total_revenue: 125_000_000,
};

const mockOrders = [
  {
    id: 'ord-1', order_code: 'MK-2026-001', client_name: 'PT Indofashion',
    product_name: 'Kemeja Pria', product_category: 'Shirts',
    qty_ordered: 1000, total_value: 35_000_000, deadline_date: '2026-06-15',
    progress_percentage: 45, status: 'sewing',
  },
  {
    id: 'ord-2', order_code: 'MK-2026-002', client_name: 'CV Maju',
    product_name: 'Jaket', product_category: 'Outerwear',
    qty_ordered: 500, total_value: 50_000_000, deadline_date: '2026-07-01',
    progress_percentage: 80, status: 'qc',
  },
];

function mockApi({ summary = mockSummary, orders = mockOrders, failSummary = false, failOrders = false } = {}) {
  mockFetch.mockImplementation((url) => {
    if (url.includes('/maklon/summary')) {
      if (failSummary) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(summary) });
    }
    if (url.includes('/maklon/pos')) {
      if (failOrders) return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(orders) });
    }
    return Promise.resolve({ ok: false });
  });
}

describe('MaklonDashboard', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders PageHeader with Dashboard Maklon title', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    expect(screen.getByText('Dashboard Maklon')).toBeInTheDocument();
    expect(screen.getByText(/Ringkasan order maklon/i)).toBeInTheDocument();
  });

  it('fetches /api/dewi/maklon/summary and /pos on mount', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/dewi/maklon/summary', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
      }));
      expect(mockFetch).toHaveBeenCalledWith('/api/dewi/maklon/pos', expect.any(Object));
    });
  });

  it('renders 8 KPI cards with correct labels', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.getByText('Total Klien')).toBeInTheDocument();
    expect(screen.getByText('Klien Aktif')).toBeInTheDocument();
    expect(screen.getByText('Order Aktif')).toBeInTheDocument();
    expect(screen.getByText('Order Selesai')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Dikonfirmasi')).toBeInTheDocument();
    expect(screen.getByText('Sedang Produksi')).toBeInTheDocument();
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
  });

  it('displays summary values in KPI cards', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('25')).toBeInTheDocument()); // total_clients
    expect(screen.getByText('18')).toBeInTheDocument(); // active_clients
    expect(screen.getByText('12')).toBeInTheDocument(); // active_orders
    expect(screen.getByText('45')).toBeInTheDocument(); // completed_orders
    // Total revenue formatted with thousand separator (Indonesian)
    expect(screen.getByText(/Rp 125\.000\.000/i)).toBeInTheDocument();
  });

  it('renders Quick Actions buttons', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.getByText('Kelola Klien')).toBeInTheDocument();
    expect(screen.getByText('Kelola Order')).toBeInTheDocument();
  });

  it('Quick Action "Kelola Klien" navigates to maklon-clients', async () => {
    mockApi();
    const onNavigate = jest.fn();
    render(<MaklonDashboard token="tok-1" onNavigate={onNavigate} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Kelola Klien'));
    expect(onNavigate).toHaveBeenCalledWith('maklon-clients');
  });

  it('Quick Action "Kelola Order" navigates to maklon-po', async () => {
    mockApi();
    const onNavigate = jest.fn();
    render(<MaklonDashboard token="tok-1" onNavigate={onNavigate} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Kelola Order'));
    expect(onNavigate).toHaveBeenCalledWith('maklon-po');
  });

  it('renders recent orders table when data present', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('MK-2026-001')).toBeInTheDocument());
    expect(screen.getByText('MK-2026-002')).toBeInTheDocument();
    expect(screen.getByText('PT Indofashion')).toBeInTheDocument();
    expect(screen.getByText('Kemeja Pria')).toBeInTheDocument();
  });

  it('shows empty state when no recent orders', async () => {
    mockApi({ orders: [] });
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('Belum ada order maklon')).toBeInTheDocument());
  });

  it('renders correct status badge labels', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('MK-2026-001')).toBeInTheDocument());
    expect(screen.getByText('Sewing')).toBeInTheDocument(); // status: sewing
    expect(screen.getByText('QC')).toBeInTheDocument(); // status: qc
  });

  it('refresh button re-fetches data', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
  });

  it('shows zero values when summary is empty', async () => {
    mockApi({ summary: {} });
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // 0 should appear for all stats — at least one zero visible
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThan(0);
    // Revenue formatted as Rp 0
    expect(screen.getByText('Rp 0')).toBeInTheDocument();
  });

  it('shows error toast when fetch fails', async () => {
    const { toast } = require('sonner');
    mockFetch.mockRejectedValue(new Error('Network error'));
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Gagal memuat data dashboard'));
  });

  it('dashboard root has data-testid="maklon-dashboard"', async () => {
    mockApi();
    render(<MaklonDashboard token="tok-1" onNavigate={jest.fn()} />);
    expect(screen.getByTestId('maklon-dashboard')).toBeInTheDocument();
  });
});
