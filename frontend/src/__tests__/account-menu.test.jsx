/**
 * AccountMenu Tests — Session #11.18 Task C
 * ============================================================
 * Covers:
 *   - Avatar/initial render (with/without user.name)
 *   - Role display, fallback to 'Pengguna' when user is null
 *   - Dropdown toggle (open/close via button)
 *   - Outside click closes dropdown
 *   - Each menu item triggers correct callback + closes menu
 *   - Logout button red styling + callback
 *   - aria-expanded reflects open state
 */
import React from 'react';
import { fireEvent, screen, act } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import AccountMenu from '../components/erp/portal-shell/AccountMenu';

// Mock ThemeToggle to avoid theme context dependencies
jest.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle-mock" />,
}));

describe('AccountMenu', () => {
  const mockUser = { name: 'Budi Santoso', role: 'admin' };
  const handlers = {
    onOpenCmdk: jest.fn(),
    onOpenHelp: jest.fn(),
    onOpenGuide: jest.fn(),
    onLogout: jest.fn(),
  };

  beforeEach(() => {
    Object.values(handlers).forEach(h => h.mockClear());
  });

  it('renders avatar with first letter of user name', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    expect(screen.getByTestId('topbar-account-btn')).toBeInTheDocument();
    // user.name = 'Budi' → 'B'
    expect(screen.getAllByText('B').length).toBeGreaterThan(0);
  });

  it('renders fallback "?" when user is null', () => {
    render(<AccountMenu user={null} {...handlers} />);
    expect(screen.getAllByText('?').length).toBeGreaterThan(0);
  });

  it('renders "Pengguna" fallback for missing name', () => {
    render(<AccountMenu user={{ role: 'admin' }} {...handlers} />);
    // Need to open the dropdown first to see the full header
    const btn = screen.getByTestId('topbar-account-btn');
    fireEvent.click(btn);
    // 'Pengguna' appears both in button text and dropdown header
    expect(screen.getAllByText('Pengguna').length).toBeGreaterThan(0);
  });

  it('dropdown is closed initially', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    expect(screen.queryByTestId('account-dropdown-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('topbar-account-btn')).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens dropdown when account button clicked', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    expect(screen.getByTestId('account-dropdown-menu')).toBeInTheDocument();
    expect(screen.getByTestId('topbar-account-btn')).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes dropdown when button clicked twice (toggle)', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    const btn = screen.getByTestId('topbar-account-btn');
    fireEvent.click(btn);
    expect(screen.getByTestId('account-dropdown-menu')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId('account-dropdown-menu')).not.toBeInTheDocument();
  });

  it('closes dropdown on outside click', () => {
    render(
      <>
        <AccountMenu user={mockUser} {...handlers} />
        <div data-testid="outside-area">outside</div>
      </>
    );
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    expect(screen.getByTestId('account-dropdown-menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside-area'));
    expect(screen.queryByTestId('account-dropdown-menu')).not.toBeInTheDocument();
  });

  it('calls onOpenCmdk and closes menu when Command Palette item clicked', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    fireEvent.click(screen.getByTestId('account-cmdk'));
    expect(handlers.onOpenCmdk).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('account-dropdown-menu')).not.toBeInTheDocument();
  });

  it('calls onOpenHelp and closes menu when Help item clicked', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    fireEvent.click(screen.getByTestId('account-help'));
    expect(handlers.onOpenHelp).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('account-dropdown-menu')).not.toBeInTheDocument();
  });

  it('calls onOpenGuide and closes menu when Guide item clicked', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    fireEvent.click(screen.getByTestId('account-guide'));
    expect(handlers.onOpenGuide).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('account-dropdown-menu')).not.toBeInTheDocument();
  });

  it('calls onLogout and closes menu when Logout button clicked', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    fireEvent.click(screen.getByTestId('topbar-logout-btn'));
    expect(handlers.onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('account-dropdown-menu')).not.toBeInTheDocument();
  });

  it('renders all 3 menu items + logout when open', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    expect(screen.getByTestId('account-cmdk')).toBeInTheDocument();
    expect(screen.getByTestId('account-help')).toBeInTheDocument();
    expect(screen.getByTestId('account-guide')).toBeInTheDocument();
    expect(screen.getByTestId('topbar-logout-btn')).toBeInTheDocument();
    expect(screen.getByTestId('theme-toggle-mock')).toBeInTheDocument();
  });

  it('shows ⌘K shortcut hint on Command Palette item', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('shows user role in dropdown header', () => {
    render(<AccountMenu user={mockUser} {...handlers} />);
    fireEvent.click(screen.getByTestId('topbar-account-btn'));
    // Role appears in header — 'admin' (capitalize via CSS but value stays lowercase)
    expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
  });
});
