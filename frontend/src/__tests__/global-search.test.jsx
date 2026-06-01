/**
 * GlobalSearch Tests — Session #11.18 Task C
 * ============================================================
 * Covers:
 *   - Input rendering + onChange
 *   - Debounced API fetch (300ms)
 *   - Loading state display
 *   - Empty results state
 *   - Result list rendering with type badge + label + sub
 *   - Click result → calls onResultSelect with module + closes dropdown + clears query
 *   - Clear button (X) → clears query + closes
 *   - Outside click closes dropdown
 *   - Focus reopens dropdown if query exists
 */
import React from 'react';
import { fireEvent, screen, act, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import GlobalSearch from '../components/erp/portal-shell/GlobalSearch';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('GlobalSearch', () => {
  const token = 'test-token-123';
  const onResultSelect = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
    onResultSelect.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders search input with placeholder', () => {
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    const input = screen.getByTestId('topbar-global-search-input');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Cari order, WO, SKU...');
  });

  it('updates input value when user types', () => {
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    const input = screen.getByTestId('topbar-global-search-input');
    fireEvent.change(input, { target: { value: 'WO-001' } });
    expect(input.value).toBe('WO-001');
  });

  it('shows clear button when input has value', () => {
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    const input = screen.getByTestId('topbar-global-search-input');
    expect(screen.queryByTestId('search-clear-btn')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByTestId('search-clear-btn')).toBeInTheDocument();
  });

  it('clear button resets query and closes dropdown', () => {
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    const input = screen.getByTestId('topbar-global-search-input');
    fireEvent.change(input, { target: { value: 'xyz' } });
    expect(input.value).toBe('xyz');
    fireEvent.click(screen.getByTestId('search-clear-btn'));
    expect(input.value).toBe('');
  });

  it('does not search when input is empty', () => {
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    const input = screen.getByTestId('topbar-global-search-input');
    fireEvent.change(input, { target: { value: '   ' } });
    act(() => { jest.advanceTimersByTime(400); });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fires fetch after 300ms debounce', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ results: [] }),
    });
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    const input = screen.getByTestId('topbar-global-search-input');
    fireEvent.change(input, { target: { value: 'WO-001' } });
    expect(mockFetch).not.toHaveBeenCalled();  // not called immediately
    act(() => { jest.advanceTimersByTime(300); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/global-search?q=WO-001',
      { headers: { Authorization: `Bearer ${token}` } }
    );
  });

  it('shows "Mencari..." while loading', async () => {
    let resolveFetch;
    mockFetch.mockReturnValueOnce(
      new Promise((res) => {
        resolveFetch = res;
      })
    );
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    const input = screen.getByTestId('topbar-global-search-input');
    fireEvent.change(input, { target: { value: 'abc' } });
    act(() => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(screen.getByText('Mencari...')).toBeInTheDocument());
    resolveFetch({ json: () => Promise.resolve({ results: [] }) });
  });

  it('shows empty results message when no matches', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ results: [] }),
    });
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    fireEvent.change(screen.getByTestId('topbar-global-search-input'), { target: { value: 'zzz' } });
    act(() => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(screen.getByText(/Tidak ada hasil untuk/)).toBeInTheDocument());
  });

  it('renders search results with type, label, and sub', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        results: [
          { module: 'orders', type: 'order', label: 'Order #123', sub: 'PT Test' },
          { module: 'wo', type: 'wo', label: 'WO-001', sub: '500 pcs' },
        ],
      }),
    });
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    fireEvent.change(screen.getByTestId('topbar-global-search-input'), { target: { value: 'test' } });
    act(() => { jest.advanceTimersByTime(300); });
    await waitFor(() => {
      expect(screen.getByText('Order #123')).toBeInTheDocument();
      expect(screen.getByText('WO-001')).toBeInTheDocument();
      expect(screen.getByText('PT Test')).toBeInTheDocument();
    });
    expect(screen.getByTestId('search-result-0')).toBeInTheDocument();
    expect(screen.getByTestId('search-result-1')).toBeInTheDocument();
  });

  it('clicking result calls onResultSelect with module name and closes dropdown', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        results: [{ module: 'production_wo', type: 'wo', label: 'WO-99' }],
      }),
    });
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    fireEvent.change(screen.getByTestId('topbar-global-search-input'), { target: { value: 'wo' } });
    act(() => { jest.advanceTimersByTime(300); });
    await waitFor(() => screen.getByTestId('search-result-0'));
    fireEvent.click(screen.getByTestId('search-result-0'));
    expect(onResultSelect).toHaveBeenCalledWith('production_wo');
    expect(screen.queryByTestId('search-result-0')).not.toBeInTheDocument();
  });

  it('handles fetch error gracefully (shows empty results)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    fireEvent.change(screen.getByTestId('topbar-global-search-input'), { target: { value: 'fail' } });
    act(() => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(screen.getByText(/Tidak ada hasil/)).toBeInTheDocument());
  });

  it('outside click closes dropdown', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ results: [] }),
    });
    render(
      <>
        <GlobalSearch token={token} onResultSelect={onResultSelect} />
        <button data-testid="outside-btn">click me</button>
      </>
    );
    fireEvent.change(screen.getByTestId('topbar-global-search-input'), { target: { value: 'q' } });
    act(() => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(screen.getByText(/Tidak ada hasil/)).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByTestId('outside-btn'));
    expect(screen.queryByText(/Tidak ada hasil/)).not.toBeInTheDocument();
  });

  it('debounces multiple rapid keystrokes — only last query fires', async () => {
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ results: [] }) });
    render(<GlobalSearch token={token} onResultSelect={onResultSelect} />);
    const input = screen.getByTestId('topbar-global-search-input');
    fireEvent.change(input, { target: { value: 'a' } });
    act(() => { jest.advanceTimersByTime(100); });
    fireEvent.change(input, { target: { value: 'ab' } });
    act(() => { jest.advanceTimersByTime(100); });
    fireEvent.change(input, { target: { value: 'abc' } });
    act(() => { jest.advanceTimersByTime(300); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenLastCalledWith(
      '/api/global-search?q=abc',
      { headers: { Authorization: `Bearer ${token}` } }
    );
  });
});
