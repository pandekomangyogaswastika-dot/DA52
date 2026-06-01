/**
 * CuttingHubModule Tests — Session #11.17 Task 3
 * ================================================
 * Covers:
 *   - Tab rendering (planning + execution)
 *   - Tab switching via click
 *   - Active tab visual state (aria-selected)
 *   - URL hash sync (deep-link)
 *   - Default tab is 'planning'
 *   - deepLinkParams.tab='execution' preselects execution tab
 */
import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import CuttingHubModule from '../components/erp/CuttingHubModule';

// Mock the heavy lazy-loaded sub-modules with simple stubs so the tests run fast
// and don't trigger their own API calls.
jest.mock('../components/erp/CuttingProcessModule', () => ({
  __esModule: true,
  default: () => <div data-testid="cutting-process-module-stub">CuttingProcessModule stub</div>,
}));
jest.mock('../components/erp/ProcessExecutionModule', () => ({
  __esModule: true,
  default: ({ moduleId }) => (
    <div data-testid="process-execution-module-stub" data-module-id={moduleId}>
      ProcessExecutionModule stub
    </div>
  ),
}));

const defaultProps = {
  token: 'test-token',
  user: { id: 1, name: 'tester' },
  headers: { Authorization: 'Bearer test-token' },
  userRole: 'production_manager',
  hasPerm: () => true,
  onNavigate: jest.fn(),
  moduleId: 'prod-cutting',
  deepLinkParams: {},
};

describe('CuttingHubModule', () => {
  beforeEach(() => {
    // Reset URL hash so tab default can be deterministic
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '#prod-cutting');
    }
  });

  it('renders the module shell with HUB badge and 2 tabs', () => {
    render(<CuttingHubModule {...defaultProps} />);
    expect(screen.getByTestId('cutting-hub-module')).toBeInTheDocument();
    expect(screen.getByText('Cutting Hub')).toBeInTheDocument();
    expect(screen.getByText('HUB')).toBeInTheDocument();
    expect(screen.getByTestId('cutting-hub-tab-planning')).toBeInTheDocument();
    expect(screen.getByTestId('cutting-hub-tab-execution')).toBeInTheDocument();
  });

  it('defaults to Planning tab when no hash and no deepLinkParams', () => {
    window.history.replaceState(null, '', '#prod-cutting');
    render(<CuttingHubModule {...defaultProps} />);
    const planning = screen.getByTestId('cutting-hub-tab-planning');
    expect(planning).toHaveAttribute('aria-selected', 'true');
    const exec = screen.getByTestId('cutting-hub-tab-execution');
    expect(exec).toHaveAttribute('aria-selected', 'false');
  });

  it('switches to Execution tab when clicked', async () => {
    render(<CuttingHubModule {...defaultProps} />);
    fireEvent.click(screen.getByTestId('cutting-hub-tab-execution'));
    await waitFor(() => {
      expect(screen.getByTestId('cutting-hub-tab-execution')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('cutting-hub-tab-planning')).toHaveAttribute('aria-selected', 'false');
    });
  });

  it('updates URL hash when switching tabs', async () => {
    render(<CuttingHubModule {...defaultProps} />);
    fireEvent.click(screen.getByTestId('cutting-hub-tab-execution'));
    await waitFor(() => {
      expect(window.location.hash).toBe('#prod-cutting=execution');
    });
  });

  it('preselects Execution tab when deepLinkParams.tab="execution"', () => {
    window.history.replaceState(null, '', '#prod-cutting');
    render(
      <CuttingHubModule
        {...defaultProps}
        deepLinkParams={{ tab: 'execution' }}
      />,
    );
    expect(screen.getByTestId('cutting-hub-tab-execution')).toHaveAttribute('aria-selected', 'true');
  });

  it('preselects Execution tab when URL hash has =execution', () => {
    window.history.replaceState(null, '', '#prod-cutting=execution');
    render(<CuttingHubModule {...defaultProps} />);
    expect(screen.getByTestId('cutting-hub-tab-execution')).toHaveAttribute('aria-selected', 'true');
  });

  it('renders CuttingProcessModule stub in planning tab', async () => {
    render(<CuttingHubModule {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('cutting-process-module-stub')).toBeInTheDocument();
    });
  });

  it('passes moduleId="prod-exec-cutting" to ProcessExecutionModule (force CUTTING processCode)', async () => {
    window.history.replaceState(null, '', '#prod-cutting=execution');
    render(<CuttingHubModule {...defaultProps} />);
    await waitFor(() => {
      const stub = screen.getByTestId('process-execution-module-stub');
      expect(stub).toBeInTheDocument();
      expect(stub).toHaveAttribute('data-module-id', 'prod-exec-cutting');
    });
  });
});
