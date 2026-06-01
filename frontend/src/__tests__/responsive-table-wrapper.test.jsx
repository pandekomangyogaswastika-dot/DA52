/**
 * ResponsiveTableWrapper Tests — TD-015 (Session #11.13)
 * =======================================================
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { ResponsiveTableWrapper } from '../components/ui/responsive-table-wrapper';

describe('ResponsiveTableWrapper', () => {
  it('renders children inside an overflow-x-auto container', () => {
    const { container } = render(
      <ResponsiveTableWrapper>
        <table data-testid="t">
          <tbody><tr><td>cell</td></tr></tbody>
        </table>
      </ResponsiveTableWrapper>,
    );
    expect(screen.getByTestId('t')).toBeInTheDocument();
    // scroll container has overflow-x-auto
    const wrapperOuter = container.firstChild;
    const scrollChild = wrapperOuter.querySelector('.overflow-x-auto');
    expect(scrollChild).toBeInTheDocument();
  });

  it('applies sticky-first-col class when stickyFirstCol prop set', () => {
    const { container } = render(
      <ResponsiveTableWrapper stickyFirstCol>
        <table>
          <tbody><tr><td>x</td></tr></tbody>
        </table>
      </ResponsiveTableWrapper>,
    );
    const wrapperOuter = container.firstChild;
    const scrollChild = wrapperOuter.querySelector('.overflow-x-auto');
    expect(scrollChild.className).toMatch(/sticky/);
  });

  it('does not render scroll-shadow when no overflow', () => {
    const { container } = render(
      <ResponsiveTableWrapper>
        <table><tbody><tr><td>x</td></tr></tbody></table>
      </ResponsiveTableWrapper>,
    );
    // jsdom doesn't simulate layout, so scrollLeft=scrollWidth=clientWidth=0 → no shadows
    const shadows = container.querySelectorAll('[aria-hidden="true"]');
    // 0 because no overflow detected in jsdom
    expect(shadows.length).toBe(0);
  });

  it('renders shadows when scrolled (simulated)', () => {
    const { container } = render(
      <ResponsiveTableWrapper>
        <table><tbody><tr><td>x</td></tr></tbody></table>
      </ResponsiveTableWrapper>,
    );
    const scrollEl = container.querySelector('.overflow-x-auto');
    // Simulate overflow by setting properties + firing scroll
    Object.defineProperty(scrollEl, 'scrollLeft', { value: 50, configurable: true });
    Object.defineProperty(scrollEl, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(scrollEl, 'clientWidth', { value: 200, configurable: true });
    act(() => {
      scrollEl.dispatchEvent(new Event('scroll'));
    });
    // After scroll, both left+right shadows should show
    const shadows = container.querySelectorAll('[aria-hidden="true"]');
    expect(shadows.length).toBeGreaterThan(0);
  });
});
