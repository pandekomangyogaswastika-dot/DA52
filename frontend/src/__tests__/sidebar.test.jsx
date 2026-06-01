/**
 * Sidebar Tests — Session #11.18 Task A
 * ============================================================
 * Covers:
 *   - Section header label rendering
 *   - Collapse button toggle (calls setCollapsed)
 *   - Collapsed mode hides section label
 *   - Mobile drawer dismiss button
 *   - Mobile section dropdown (renders all sections + onChange)
 *   - Flat items rendering when section has no groups
 *   - Grouped items rendering when section has groups
 *   - Active NavItem highlighted (currentModule prop)
 *   - Empty state when section has no items
 *   - Mobile overlay (renders + click closes mobile drawer)
 *   - Footer: RecentModulesFooter mounted, TV link visible (only when expanded)
 */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { Folder, Settings } from 'lucide-react';
import { renderWithProviders as render } from './_test-utils';
import Sidebar from '../components/erp/portal-shell/Sidebar';

// Mock RecentModulesFooter to avoid localStorage dependency
jest.mock('../components/erp/portal-shell/RecentModulesFooter', () => () => (
  <div data-testid="recent-footer-mock" />
));

describe('Sidebar', () => {
  const navData = {
    sections: [
      { label: 'PRODUCTION', items: [
        { id: 'wo', label: 'Work Orders', icon: Folder },
        { id: 'oee', label: 'OEE', icon: Folder },
      ] },
      { label: 'WAREHOUSE', items: [
        { id: 'wms', label: 'WMS Buildings', icon: Folder },
      ] },
      { label: 'SETTINGS', groups: [
        { label: 'GENERAL', items: [
          { id: 'company', label: 'Company', icon: Settings },
        ] },
        { label: 'USERS', items: [
          { id: 'users', label: 'Users', icon: Settings },
        ] },
      ] },
    ],
  };
  const baseProps = {
    portal: 'dewi',
    nav: navData,
    activeSection: navData.sections[0],
    currentModule: 'wo',
    collapsed: false,
    setCollapsed: jest.fn(),
    mobileOpen: false,
    setMobileOpen: jest.fn(),
    onModuleChange: jest.fn(),
    onSectionChange: jest.fn(),
  };

  beforeEach(() => {
    Object.values(baseProps).forEach((v) => {
      if (typeof v === 'function') v.mockClear();
    });
  });

  it('renders sidebar with active section label', () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.getByTestId('portal-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-active-section')).toHaveTextContent(/PRODUCTION/i);
  });

  it('renders all items of the active section (flat)', () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.getByText('Work Orders')).toBeInTheDocument();
    expect(screen.getByText('OEE')).toBeInTheDocument();
  });

  it('renders items from groups when section has groups', () => {
    render(<Sidebar {...baseProps} activeSection={navData.sections[2]} currentModule="company" />);
    expect(screen.getByTestId('sidebar-group-header-GENERAL')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-group-header-USERS')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('toggle collapse button calls setCollapsed', () => {
    render(<Sidebar {...baseProps} />);
    fireEvent.click(screen.getByTestId('sidebar-toggle-btn'));
    expect(baseProps.setCollapsed).toHaveBeenCalledWith(true);
  });

  it('toggle collapse button toggles back when collapsed', () => {
    render(<Sidebar {...baseProps} collapsed={true} />);
    fireEvent.click(screen.getByTestId('sidebar-toggle-btn'));
    expect(baseProps.setCollapsed).toHaveBeenCalledWith(false);
  });

  it('hides section label when collapsed=true', () => {
    render(<Sidebar {...baseProps} collapsed={true} />);
    expect(screen.queryByTestId('sidebar-active-section')).not.toBeInTheDocument();
  });

  it('hides TV link and breadcrumb when collapsed=true', () => {
    render(<Sidebar {...baseProps} collapsed={true} />);
    expect(screen.queryByTestId('sidebar-tv-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('topbar-module-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recent-footer-mock')).not.toBeInTheDocument();
  });

  it('shows TV link + breadcrumb + recent footer when expanded', () => {
    render(<Sidebar {...baseProps} collapsed={false} />);
    expect(screen.getByTestId('sidebar-tv-link')).toBeInTheDocument();
    expect(screen.getByTestId('topbar-module-title')).toBeInTheDocument();
    expect(screen.getByTestId('recent-footer-mock')).toBeInTheDocument();
  });

  it('TV link points to /tv with target=_blank', () => {
    render(<Sidebar {...baseProps} />);
    const link = screen.getByTestId('sidebar-tv-link');
    expect(link).toHaveAttribute('href', '/tv');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('mobile section dropdown appears only when mobileOpen=true', () => {
    const { rerender } = render(<Sidebar {...baseProps} mobileOpen={false} />);
    expect(screen.queryByTestId('mobile-section-select')).not.toBeInTheDocument();
    rerender(<Sidebar {...baseProps} mobileOpen={true} />);
    expect(screen.getByTestId('mobile-section-select')).toBeInTheDocument();
  });

  it('mobile section dropdown lists all sections', () => {
    render(<Sidebar {...baseProps} mobileOpen={true} />);
    const select = screen.getByTestId('mobile-section-select');
    expect(select.querySelectorAll('option').length).toBe(3);
    expect(select.value).toBe('PRODUCTION');
  });

  it('mobile section dropdown change calls onSectionChange', () => {
    render(<Sidebar {...baseProps} mobileOpen={true} />);
    fireEvent.change(screen.getByTestId('mobile-section-select'), { target: { value: 'WAREHOUSE' } });
    expect(baseProps.onSectionChange).toHaveBeenCalledWith('WAREHOUSE');
  });

  it('mobile overlay rendered + click dismisses mobile drawer', () => {
    const { container } = render(<Sidebar {...baseProps} mobileOpen={true} />);
    const overlay = container.querySelector('[aria-hidden="true"].fixed.inset-0');
    expect(overlay).toBeTruthy();
    fireEvent.click(overlay);
    expect(baseProps.setMobileOpen).toHaveBeenCalledWith(false);
  });

  it('empty section renders "Belum ada item" message', () => {
    render(<Sidebar {...baseProps} activeSection={{ label: 'EMPTY', items: [] }} />);
    expect(screen.getByText(/Belum ada item/)).toBeInTheDocument();
  });

  it('clicking a nav item calls onModuleChange', () => {
    render(<Sidebar {...baseProps} />);
    // The "OEE" item should be clickable
    const navItem = screen.getByTestId('nav-item-oee');
    expect(navItem).toBeInTheDocument();
    fireEvent.click(navItem);
    expect(baseProps.onModuleChange).toHaveBeenCalledWith('oee');
  });

  it('active NavItem has active background class', () => {
    render(<Sidebar {...baseProps} currentModule="wo" />);
    const activeItem = screen.getByTestId('nav-item-wo');
    // Active items have bg-[var(--nav-pill-active)] class
    expect(activeItem.className).toMatch(/nav-pill-active/);
    // Inactive items don't
    const inactiveItem = screen.getByTestId('nav-item-oee');
    expect(inactiveItem.className).not.toMatch(/nav-pill-active/);
  });

  it('handles activeSection = null gracefully', () => {
    render(<Sidebar {...baseProps} activeSection={null} />);
    expect(screen.getByTestId('portal-sidebar')).toBeInTheDocument();
    // sidebar-active-section is rendered when not collapsed (formatSectionLabel('') is empty string)
    expect(screen.getByText(/Belum ada item/)).toBeInTheDocument();
  });
});
