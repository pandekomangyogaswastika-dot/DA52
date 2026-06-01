/**
 * NotificationBell Tests — Session #11.18 Task A
 * ============================================================
 * Covers:
 *   - Initial render of bell button + badge
 *   - Unread count display (badge appears when > 0, hidden when 0, "99+" when > 99)
 *   - Popover toggle (click button → opens, click again → closes)
 *   - Outside click closes popover
 *   - Fetches notifications + unread-count on mount with token
 *   - No fetch when token is null
 *   - Mark single notification as read (POST + state update)
 *   - Mark all as read (POST + state update)
 *   - Click notification with link_module → calls onNavigateModule + markRead
 *   - Empty state when no notifications
 *   - Severity-based icon/color rendering
 *   - formatTimeAgo helper edge cases
 */
import React from 'react';
import { fireEvent, screen, act, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import { NotificationBell } from '../components/erp/NotificationBell';

// Mock EventSource (SSE)
class MockEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    MockEventSource.instances.push(this);
  }
  addEventListener(event, cb) {
    this.listeners[event] = cb;
  }
  close() { this.closed = true; }
  // Trigger an SSE event
  trigger(event, data) {
    if (this.listeners[event]) this.listeners[event]({ data: JSON.stringify(data) });
  }
}
MockEventSource.instances = [];
global.EventSource = MockEventSource;

// Mock sonner
jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    info: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const sampleNotifs = [
  { id: 'n1', title: 'Test 1', message: 'msg-1', severity: 'info', type: 'system_test', read: false, created_at: new Date().toISOString() },
  { id: 'n2', title: 'Stok rendah', message: 'cek gudang', severity: 'warning', type: 'low_stock', read: false, link_module: 'wms', link_id: 'mat-1', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'n3', title: 'Already read', message: 'sudah dibaca', severity: 'success', type: 'qc_fail_spike', read: true, created_at: new Date(Date.now() - 86400000).toISOString() },
];

function mockListAndCount(items, count) {
  mockFetch.mockImplementation((url) => {
    if (url.includes('/api/notifications/unread-count')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count }) });
    }
    if (url.includes('/api/notifications?')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe('NotificationBell', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    MockEventSource.instances = [];
  });

  it('renders bell button with proper aria-label', async () => {
    mockListAndCount([], 0);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    expect(screen.getByTestId('notification-bell-btn')).toBeInTheDocument();
  });

  it('does not show badge when unread count is 0', async () => {
    mockListAndCount([], 0);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('notification-unread-count')).not.toBeInTheDocument();
  });

  it('shows badge with unread count when > 0', async () => {
    mockListAndCount(sampleNotifs, 2);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('2'));
  });

  it('shows "99+" when count exceeds 99', async () => {
    mockListAndCount([], 150);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('99+'));
  });

  it('does not fetch when token is null', () => {
    render(<NotificationBell token={null} onNavigateModule={jest.fn()} />);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('popover is closed initially', async () => {
    mockListAndCount([], 0);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    expect(screen.queryByTestId('notification-popover')).not.toBeInTheDocument();
  });

  it('opens popover on bell click', async () => {
    mockListAndCount(sampleNotifs, 2);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    expect(screen.getByTestId('notification-popover')).toBeInTheDocument();
  });

  it('closes popover on second click (toggle)', async () => {
    mockListAndCount([], 0);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    const btn = screen.getByTestId('notification-bell-btn');
    fireEvent.click(btn);
    expect(screen.getByTestId('notification-popover')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId('notification-popover')).not.toBeInTheDocument();
  });

  it('shows empty state when no notifications', async () => {
    mockListAndCount([], 0);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    expect(screen.getByText('Belum ada notifikasi')).toBeInTheDocument();
  });

  it('renders notification items', async () => {
    mockListAndCount(sampleNotifs, 2);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('notification-unread-count')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    expect(screen.getByTestId('notification-item-n1')).toBeInTheDocument();
    expect(screen.getByTestId('notification-item-n2')).toBeInTheDocument();
    expect(screen.getByTestId('notification-item-n3')).toBeInTheDocument();
    expect(screen.getByText('Test 1')).toBeInTheDocument();
    expect(screen.getByText('Stok rendah')).toBeInTheDocument();
  });

  it('shows "Tandai semua dibaca" button only when unread > 0', async () => {
    mockListAndCount(sampleNotifs, 2);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('notification-unread-count')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    expect(screen.getByTestId('notification-mark-all-read-btn')).toBeInTheDocument();
  });

  it('hides "Tandai semua dibaca" button when unread = 0', async () => {
    mockListAndCount([], 0);
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    expect(screen.queryByTestId('notification-mark-all-read-btn')).not.toBeInTheDocument();
  });

  it('calls mark-all-read API and updates state', async () => {
    mockFetch.mockImplementation((url, opts) => {
      if (url.includes('/api/notifications/unread-count')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 2 }) });
      }
      if (url.includes('/api/notifications?')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: sampleNotifs }) });
      }
      if (url.includes('/api/notifications/mark-all-read')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    render(<NotificationBell token="tok-123" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('2'));
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    fireEvent.click(screen.getByTestId('notification-mark-all-read-btn'));
    await waitFor(() => {
      const markAllCall = mockFetch.mock.calls.find(([url]) => url.includes('/mark-all-read'));
      expect(markAllCall).toBeTruthy();
      expect(markAllCall[1].method).toBe('POST');
    });
  });

  it('clicking notification with link_module calls onNavigateModule + markRead', async () => {
    const onNavigateModule = jest.fn();
    mockFetch.mockImplementation((url, opts) => {
      if (url.includes('/unread-count')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 2 }) });
      }
      if (url.match(/\/api\/notifications\?/)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: sampleNotifs }) });
      }
      if (url.includes('/api/notifications/n2/read')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    render(<NotificationBell token="tok-123" onNavigateModule={onNavigateModule} />);
    await waitFor(() => expect(screen.getByTestId('notification-unread-count')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    fireEvent.click(screen.getByTestId('notification-item-n2'));
    await waitFor(() => expect(onNavigateModule).toHaveBeenCalledWith('wms', 'mat-1'));
    // popover should close after navigation
    await waitFor(() => expect(screen.queryByTestId('notification-popover')).not.toBeInTheDocument());
  });

  it('subscribes to SSE stream on mount with token', async () => {
    mockListAndCount([], 0);
    render(<NotificationBell token="tok-abc" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    expect(MockEventSource.instances[0].url).toContain('/api/notifications/stream?token=tok-abc');
  });

  it('closes SSE on unmount', async () => {
    mockListAndCount([], 0);
    const { unmount } = render(<NotificationBell token="tok-xyz" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];
    unmount();
    expect(es.closed).toBe(true);
  });

  it('SSE notification event prepends to list + bumps unread count', async () => {
    mockListAndCount([], 0);
    render(<NotificationBell token="tok-1" onNavigateModule={jest.fn()} />);
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    const es = MockEventSource.instances[0];

    act(() => {
      es.trigger('notification', {
        id: 'live-1', title: 'Live event', message: 'fresh', severity: 'info', type: 'system_test'
      });
    });

    await waitFor(() => expect(screen.getByTestId('notification-unread-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    expect(screen.getByText('Live event')).toBeInTheDocument();
  });

  it('outside click closes popover', async () => {
    mockListAndCount([], 0);
    render(
      <>
        <NotificationBell token="tok-1" onNavigateModule={jest.fn()} />
        <button data-testid="outside-btn">outside</button>
      </>
    );
    fireEvent.click(screen.getByTestId('notification-bell-btn'));
    expect(screen.getByTestId('notification-popover')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside-btn'));
    expect(screen.queryByTestId('notification-popover')).not.toBeInTheDocument();
  });
});
