/**
 * PortalShell Sub-Components Tests — Session #11.17 Task 3
 * ============================================================
 * Covers:
 *   - NavItem (header, module button, external link, badge, active state, collapsed)
 *   - RecentModulesFooter (localStorage persistence, filter active, max 5)
 *   - portalNav helpers (findModuleLabel, sectionFlatItems, sectionContainsModule, formatSectionLabel)
 */
import React from 'react';
import { Folder } from 'lucide-react';
import { fireEvent, screen, act } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import NavItem from '../components/erp/portal-shell/NavItem';
import RecentModulesFooter from '../components/erp/portal-shell/RecentModulesFooter';
import {
  findModuleLabel,
  sectionFlatItems,
  sectionContainsModule,
  formatSectionLabel,
  PORTAL_LABEL,
  PORTAL_NAV,
} from '../components/erp/portal-shell/portalNav';

// ============================================================
// NavItem
// ============================================================
describe('NavItem', () => {
  const baseItem = { id: 'dashboard', label: 'Dashboard', icon: Folder };

  it('renders a header item as non-clickable when item.isHeader=true', () => {
    render(
      <NavItem
        item={{ id: 'sec-1', label: 'PRODUCTION', isHeader: true }}
        isActive={false}
        collapsed={false}
        onModuleChange={() => {}}
      />,
    );
    expect(screen.getByTestId('nav-header-sec-1')).toBeInTheDocument();
    expect(screen.getByText('PRODUCTION')).toBeInTheDocument();
  });

  it('renders a header as separator when collapsed=true', () => {
    const { container } = render(
      <NavItem
        item={{ id: 'sec-1', label: 'PRODUCTION', isHeader: true }}
        isActive={false}
        collapsed={true}
        onModuleChange={() => {}}
      />,
    );
    // collapsed header renders a thin divider div, no testid
    expect(container.querySelector('div[aria-hidden="true"]')).toBeTruthy();
  });

  it('calls onModuleChange when expanded module button clicked', () => {
    const onModuleChange = jest.fn();
    render(
      <NavItem
        item={baseItem}
        isActive={false}
        collapsed={false}
        onModuleChange={onModuleChange}
      />,
    );
    const btn = screen.getByTestId('nav-item-dashboard');
    fireEvent.click(btn);
    expect(onModuleChange).toHaveBeenCalledWith('dashboard');
  });

  it('calls onModuleChange when collapsed module button clicked', () => {
    const onModuleChange = jest.fn();
    render(
      <NavItem
        item={baseItem}
        isActive={false}
        collapsed={true}
        onModuleChange={onModuleChange}
      />,
    );
    fireEvent.click(screen.getByTestId('nav-item-dashboard'));
    expect(onModuleChange).toHaveBeenCalledWith('dashboard');
  });

  it('shows badge text when expanded and item.badge is set', () => {
    render(
      <NavItem
        item={{ ...baseItem, badge: 'BARU' }}
        isActive={false}
        collapsed={false}
        onModuleChange={() => {}}
      />,
    );
    expect(screen.getByText('BARU')).toBeInTheDocument();
  });

  it('renders external link with target=_blank and href when item.external + item.href', () => {
    render(
      <NavItem
        item={{ id: 'docs', label: 'Docs', icon: Folder, external: true, href: 'https://example.com/docs' }}
        isActive={false}
        collapsed={false}
        onModuleChange={() => {}}
      />,
    );
    const link = screen.getByTestId('nav-item-docs');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders external link in collapsed mode without label text', () => {
    render(
      <NavItem
        item={{ id: 'help', label: 'Help', icon: Folder, external: true, href: 'https://example.com' }}
        isActive={false}
        collapsed={true}
        onModuleChange={() => {}}
      />,
    );
    const link = screen.getByTestId('nav-item-help');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link.textContent).toBe(''); // icon only in collapsed mode
  });

  it('also calls setMobileOpen(false) when module clicked (if provided)', () => {
    const onModuleChange = jest.fn();
    const setMobileOpen = jest.fn();
    render(
      <NavItem
        item={baseItem}
        isActive={false}
        collapsed={false}
        onModuleChange={onModuleChange}
        setMobileOpen={setMobileOpen}
      />,
    );
    fireEvent.click(screen.getByTestId('nav-item-dashboard'));
    expect(setMobileOpen).toHaveBeenCalledWith(false);
  });
});

// ============================================================
// RecentModulesFooter
// ============================================================
describe('RecentModulesFooter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no recent modules exist', () => {
    const { container } = render(
      <RecentModulesFooter portal="production" currentModule="some-module" onModuleChange={() => {}} />,
    );
    // shown list is empty so component renders null
    expect(container.firstChild).toBeNull();
  });

  it('persists recent modules to localStorage under per-portal key', () => {
    const { rerender } = render(
      <RecentModulesFooter portal="production" currentModule="prod-dashboard" onModuleChange={() => {}} />,
    );
    // Initial effect runs, recent list = ['prod-dashboard']
    expect(JSON.parse(localStorage.getItem('erp_recent_production') || '[]')).toEqual(['prod-dashboard']);

    rerender(<RecentModulesFooter portal="production" currentModule="prod-cutting" onModuleChange={() => {}} />);
    expect(JSON.parse(localStorage.getItem('erp_recent_production') || '[]')).toEqual([
      'prod-cutting',
      'prod-dashboard',
    ]);
  });

  it('caps recent list at MAX=5 entries', () => {
    // Pre-seed localStorage with 6 entries
    localStorage.setItem(
      'erp_recent_production',
      JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']),
    );
    const { rerender } = render(
      <RecentModulesFooter portal="production" currentModule="new-mod" onModuleChange={() => {}} />,
    );
    rerender(<RecentModulesFooter portal="production" currentModule="new-mod" onModuleChange={() => {}} />);
    const stored = JSON.parse(localStorage.getItem('erp_recent_production') || '[]');
    expect(stored.length).toBeLessThanOrEqual(5);
    expect(stored[0]).toBe('new-mod');
  });

  it('filters out currentModule from displayed list', () => {
    localStorage.setItem(
      'erp_recent_production',
      JSON.stringify(['prod-cutting', 'prod-sewing', 'prod-dashboard']),
    );
    render(
      <RecentModulesFooter
        portal="production"
        currentModule="prod-cutting"
        onModuleChange={() => {}}
      />,
    );
    // currentModule ('prod-cutting') should NOT appear in the rendered list
    expect(screen.queryByText(/prod-cutting/i)).not.toBeInTheDocument();
  });

  it('does not crash if localStorage throws (private mode)', () => {
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = jest.fn(() => { throw new Error('blocked'); });
    expect(() => {
      render(
        <RecentModulesFooter portal="production" currentModule="x" onModuleChange={() => {}} />,
      );
    }).not.toThrow();
    Storage.prototype.getItem = originalGet;
  });
});

// ============================================================
// portalNav helpers
// ============================================================
describe('portalNav helpers', () => {
  describe('PORTAL_LABEL & PORTAL_NAV exports', () => {
    it('PORTAL_LABEL contains key portals', () => {
      expect(PORTAL_LABEL).toHaveProperty('production');
      expect(PORTAL_LABEL).toHaveProperty('warehouse');
      expect(PORTAL_LABEL).toHaveProperty('finance');
    });

    it('PORTAL_NAV has sections array for every portal', () => {
      Object.keys(PORTAL_LABEL).forEach((portalKey) => {
        const nav = PORTAL_NAV[portalKey];
        if (nav) {
          expect(Array.isArray(nav.sections)).toBe(true);
        }
      });
    });
  });

  describe('sectionFlatItems()', () => {
    it('returns items array when section has items directly', () => {
      const sec = { items: [{ id: 'a' }, { id: 'b' }] };
      expect(sectionFlatItems(sec)).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('flattens groups[].items when section has groups', () => {
      const sec = {
        groups: [
          { items: [{ id: 'a' }, { id: 'b' }] },
          { items: [{ id: 'c' }] },
        ],
      };
      expect(sectionFlatItems(sec)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    });

    it('returns empty array when section has neither items nor groups', () => {
      expect(sectionFlatItems({})).toEqual([]);
      expect(sectionFlatItems(null)).toEqual([]);
      expect(sectionFlatItems(undefined)).toEqual([]);
    });
  });

  describe('sectionContainsModule()', () => {
    it('detects module in section.items', () => {
      expect(
        sectionContainsModule({ items: [{ id: 'a' }, { id: 'b' }] }, 'b'),
      ).toBe(true);
    });

    it('detects module in section.groups[].items', () => {
      expect(
        sectionContainsModule(
          { groups: [{ items: [{ id: 'a' }] }, { items: [{ id: 'b' }] }] },
          'b',
        ),
      ).toBe(true);
    });

    it('returns false when module not in section', () => {
      expect(
        sectionContainsModule({ items: [{ id: 'a' }] }, 'b'),
      ).toBe(false);
    });

    it('returns false for null/undefined section', () => {
      expect(sectionContainsModule(null, 'x')).toBe(false);
      expect(sectionContainsModule(undefined, 'x')).toBe(false);
    });
  });

  describe('findModuleLabel()', () => {
    it('returns label when moduleId is found in portal', () => {
      // Try finance portal which has known SSOT IDs
      const label = findModuleLabel('finance', 'fin-ar-360');
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe('fin-ar-360'); // should be a label, not the id
    });

    it('returns moduleId when not found in portal', () => {
      expect(findModuleLabel('finance', 'non-existent-module-xyz')).toBe('non-existent-module-xyz');
    });

    it('returns moduleId when portal does not exist', () => {
      expect(findModuleLabel('non-existent-portal', 'any-module')).toBe('any-module');
    });

    it('Session #11.17: legacy fin-ar / fin-ap / fin-payments / fin-invoices / fin-manual-invoice are NOT in sidebar', () => {
      // After Session #11.17 cleanup, these legacy IDs should return as-is (not labeled)
      ['fin-ar', 'fin-ap', 'fin-invoices', 'fin-manual-invoice', 'fin-payments'].forEach((id) => {
        expect(findModuleLabel('finance', id)).toBe(id);
      });
    });
  });

  describe('formatSectionLabel()', () => {
    it('converts ALL CAPS to Title Case', () => {
      expect(formatSectionLabel('PRODUCTION HARIAN')).toBe('Production Harian');
    });

    it('preserves known acronyms', () => {
      expect(formatSectionLabel('LAPORAN HPP')).toBe('Laporan HPP');
      expect(formatSectionLabel('TAGIHAN AR DAN AP')).toBe('Tagihan AR Dan AP');
    });

    it('preserves acronyms inside parentheses', () => {
      expect(formatSectionLabel('PIUTANG (AR)')).toBe('Piutang (AR)');
      expect(formatSectionLabel('HUTANG (AP)')).toBe('Hutang (AP)');
    });

    it('returns empty string when label is empty/null/undefined', () => {
      expect(formatSectionLabel('')).toBe('');
      expect(formatSectionLabel(null)).toBe('');
      expect(formatSectionLabel(undefined)).toBe('');
    });
  });
});
