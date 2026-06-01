/**
 * LiveHost Sub-Components Tests — Session #11.17 Task 3
 * ====================================================
 * Covers:
 *   - utils.js: fmt(), fmtRp(), buildAuthHeader()
 *   - Badges.jsx: StatusBadge, AttendanceBadge, EmploymentTypeBadge
 */
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from './_test-utils';
import { fmt, fmtRp, buildAuthHeader } from '../components/erp/marketing/live-host/utils';
import {
  StatusBadge,
  AttendanceBadge,
  EmploymentTypeBadge,
} from '../components/erp/marketing/live-host/Badges';

// ============================================================
// utils.js — pure helpers
// ============================================================
describe('live-host/utils', () => {
  describe('fmt()', () => {
    it('formats numbers with id-ID locale (titik thousand sep)', () => {
      const r = fmt(1500000);
      // Indonesian locale uses '.' as thousand separator
      expect(r).toBe('1.500.000');
    });

    it('returns "0" for falsy values (null/undefined/0)', () => {
      expect(fmt(null)).toBe('0');
      expect(fmt(undefined)).toBe('0');
      expect(fmt(0)).toBe('0');
    });

    it('handles small integers', () => {
      expect(fmt(42)).toBe('42');
    });
  });

  describe('fmtRp()', () => {
    it('prefixes "Rp " + formatted number', () => {
      expect(fmtRp(2500000)).toBe('Rp 2.500.000');
    });

    it('falsy values → "Rp 0"', () => {
      expect(fmtRp(null)).toBe('Rp 0');
      expect(fmtRp(undefined)).toBe('Rp 0');
      expect(fmtRp(0)).toBe('Rp 0');
    });
  });

  describe('buildAuthHeader()', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('builds Bearer auth header from explicit token', () => {
      const h = buildAuthHeader('my-token');
      expect(h).toEqual({ Authorization: 'Bearer my-token' });
    });

    it('falls back to localStorage auth_token when token is falsy', () => {
      localStorage.setItem('auth_token', 'stored-token');
      const h = buildAuthHeader(null);
      expect(h).toEqual({ Authorization: 'Bearer stored-token' });
    });

    it('returns empty Bearer when neither token nor localStorage available', () => {
      const h = buildAuthHeader();
      // In jsdom localStorage exists but is empty → 'Bearer '
      expect(h.Authorization).toMatch(/^Bearer/);
    });
  });
});

// ============================================================
// Badges.jsx
// ============================================================
describe('live-host/Badges', () => {
  describe('StatusBadge', () => {
    it('renders "Active" when status="active"', () => {
      render(<StatusBadge status="active" />);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('renders "Inactive" when status="inactive"', () => {
      render(<StatusBadge status="inactive" />);
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });

    it('renders "On Leave" when status="on_leave"', () => {
      render(<StatusBadge status="on_leave" />);
      expect(screen.getByText('On Leave')).toBeInTheDocument();
    });

    it('falls back to "Inactive" config when status is unknown', () => {
      render(<StatusBadge status="unknown-status" />);
      expect(screen.getByText('Inactive')).toBeInTheDocument();
    });
  });

  describe('AttendanceBadge', () => {
    it('renders "Scheduled" with calendar icon when status="scheduled"', () => {
      render(<AttendanceBadge status="scheduled" />);
      expect(screen.getByText('Scheduled')).toBeInTheDocument();
    });

    it('renders "On Time" when status="on_time"', () => {
      render(<AttendanceBadge status="on_time" />);
      expect(screen.getByText('On Time')).toBeInTheDocument();
    });

    it('renders "Late" when status="late"', () => {
      render(<AttendanceBadge status="late" />);
      expect(screen.getByText('Late')).toBeInTheDocument();
    });

    it('renders "No Show" when status="no_show"', () => {
      render(<AttendanceBadge status="no_show" />);
      expect(screen.getByText('No Show')).toBeInTheDocument();
    });

    it('renders "Completed" when status="completed"', () => {
      render(<AttendanceBadge status="completed" />);
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('falls back to "Scheduled" when status is unknown', () => {
      render(<AttendanceBadge status="weird" />);
      expect(screen.getByText('Scheduled')).toBeInTheDocument();
    });
  });

  describe('EmploymentTypeBadge', () => {
    it('renders "Full Time" when type="full_time"', () => {
      render(<EmploymentTypeBadge type="full_time" />);
      expect(screen.getByText('Full Time')).toBeInTheDocument();
    });

    it('renders "Part Time" when type="part_time"', () => {
      render(<EmploymentTypeBadge type="part_time" />);
      expect(screen.getByText('Part Time')).toBeInTheDocument();
    });

    it('renders "Freelance" when type="freelance"', () => {
      render(<EmploymentTypeBadge type="freelance" />);
      expect(screen.getByText('Freelance')).toBeInTheDocument();
    });

    it('renders "Contract" when type="contract"', () => {
      render(<EmploymentTypeBadge type="contract" />);
      expect(screen.getByText('Contract')).toBeInTheDocument();
    });

    it('falls back to "Part Time" when type is unknown', () => {
      render(<EmploymentTypeBadge type="alien" />);
      expect(screen.getByText('Part Time')).toBeInTheDocument();
    });
  });
});
