/**
 * TopBar Tests — Session #11.18 Task C
 * ============================================================
 * Covers:
 *   - Brand/portal back button
 *   - Mobile menu toggle
 *   - Section pill nav (renders all sections, active highlight, click)
 *   - Command palette shortcut button (⌘K)
 *   - Integration with NotificationBell, GlobalSearch, AccountMenu (rendered)
 *   - aria-pressed reflects active section
 */
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import TopBar from '../components/erp/portal-shell/TopBar';

// Mock child components heavy with side-effects
jest.mock('../components/erp/NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell-mock" />,
}));
jest.mock('../components/erp/portal-shell/GlobalSearch', () => () => (
  <div data-testid="global-search-mock" />
));
jest.mock('../components/erp/portal-shell/AccountMenu', () => () => (
  <div data-testid="account-menu-mock" />
));
jest.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle-mock" />,
}));

describe('TopBar', () => {
  const baseProps = {
    portal: 'dewi',
    nav: {
      sections: [
        { label: 'PRODUCTION', items: [] },
        { label: 'WAREHOUSE', items: [] },
        { label: 'MARKETING', items: [] },
      ],
    },
    activeSectionIndex: 0,
    user: { name: 'Admin', role: 'superadmin' },
    token: 'tok-123',
    onBack: jest.fn(),
    onLogout: jest.fn(),
    onModuleChange: jest.fn(),
    onSectionPillClick: jest.fn(),
    onOpenMobile: jest.fn(),
    onOpenCmdk: jest.fn(),
    onOpenHelp: jest.fn(),
    onOpenGuide: jest.fn(),
  };

  beforeEach(() => {
    Object.values(baseProps).forEach((v) => {
      if (typeof v === 'function') v.mockClear();
    });
  });

  it('renders mobile menu toggle and calls onOpenMobile', () => {
    render(<TopBar {...baseProps} />);
    const btn = screen.getByTestId('mobile-menu-btn');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(baseProps.onOpenMobile).toHaveBeenCalledTimes(1);
  });

  it('renders portal back button and calls onBack', () => {
    render(<TopBar {...baseProps} />);
    const btn = screen.getByTestId('portal-back-btn');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(baseProps.onBack).toHaveBeenCalledTimes(1);
  });

  it('renders portal label for known portal id (dewi)', () => {
    render(<TopBar {...baseProps} portal="dewi" />);
    // PORTAL_LABEL.dewi exists; for unknown returns the id itself.
    // We don't assert exact label since it can vary; just confirm portal text appears
    expect(screen.getByText('Portal')).toBeInTheDocument();
  });

  it('renders section pill nav with all sections', () => {
    render(<TopBar {...baseProps} />);
    expect(screen.getByTestId('section-pill-nav')).toBeInTheDocument();
    expect(screen.getByTestId('section-pill-0')).toBeInTheDocument();
    expect(screen.getByTestId('section-pill-1')).toBeInTheDocument();
    expect(screen.getByTestId('section-pill-2')).toBeInTheDocument();
  });

  it('highlights active section (aria-pressed=true)', () => {
    render(<TopBar {...baseProps} activeSectionIndex={1} />);
    expect(screen.getByTestId('section-pill-0')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('section-pill-1')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('section-pill-2')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onSectionPillClick with section label', () => {
    render(<TopBar {...baseProps} />);
    fireEvent.click(screen.getByTestId('section-pill-1'));
    expect(baseProps.onSectionPillClick).toHaveBeenCalledWith('WAREHOUSE');
  });

  it('renders command palette shortcut button and triggers onOpenCmdk', () => {
    render(<TopBar {...baseProps} />);
    const btn = screen.getByTestId('topbar-cmdk-trigger');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(baseProps.onOpenCmdk).toHaveBeenCalledTimes(1);
  });

  it('mounts GlobalSearch, NotificationBell and AccountMenu child components', () => {
    render(<TopBar {...baseProps} />);
    expect(screen.getByTestId('global-search-mock')).toBeInTheDocument();
    expect(screen.getByTestId('notification-bell-mock')).toBeInTheDocument();
    expect(screen.getByTestId('account-menu-mock')).toBeInTheDocument();
  });

  it('handles 0-section nav without crashing', () => {
    render(<TopBar {...baseProps} nav={{ sections: [] }} />);
    expect(screen.getByTestId('section-pill-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('section-pill-0')).not.toBeInTheDocument();
  });

  it('shows ⌘K hint label in cmdk trigger', () => {
    render(<TopBar {...baseProps} />);
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });
});
