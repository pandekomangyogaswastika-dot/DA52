/**
 * Form Primitives Tests — TD-016 (Session #11.13)
 * ================================================
 * Validates FormSection, FormGrid, FormField, FormActions, and INPUT_BASE_CLASS.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  FormSection,
  FormGrid,
  FormField,
  FormActions,
  INPUT_BASE_CLASS,
  TEXTAREA_BASE_CLASS,
} from '../components/ui/form-primitives';

describe('FormSection', () => {
  it('renders title and description when provided', () => {
    render(
      <FormSection title="Data Dasar" description="Informasi utama">
        <span>content</span>
      </FormSection>,
    );
    expect(screen.getByText('Data Dasar')).toBeInTheDocument();
    expect(screen.getByText('Informasi utama')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('omits header when title and description not provided', () => {
    render(<FormSection><span>only content</span></FormSection>);
    expect(screen.getByText('only content')).toBeInTheDocument();
    // No header should be present
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('FormGrid', () => {
  it('applies 2-column grid by default', () => {
    const { container } = render(<FormGrid><span>x</span></FormGrid>);
    const grid = container.firstChild;
    expect(grid.className).toMatch(/grid-cols-1/);
    expect(grid.className).toMatch(/sm:grid-cols-2/);
  });

  it('applies 1-column grid when cols=1', () => {
    const { container } = render(<FormGrid cols={1}><span>x</span></FormGrid>);
    const grid = container.firstChild;
    expect(grid.className).toMatch(/grid-cols-1/);
    expect(grid.className).not.toMatch(/sm:grid-cols-2/);
  });
});

describe('FormField', () => {
  it('renders label, required marker, helper, error', () => {
    const { rerender } = render(
      <FormField label="Nama" htmlFor="nama" required helper="Wajib diisi">
        <input id="nama" />
      </FormField>,
    );
    expect(screen.getByText('Nama')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
    expect(screen.getByText('Wajib diisi')).toBeInTheDocument();

    // When error is shown, helper is hidden
    rerender(
      <FormField label="Nama" htmlFor="nama" required helper="Wajib diisi" error="Nama tidak boleh kosong">
        <input id="nama" />
      </FormField>,
    );
    expect(screen.getByText('Nama tidak boleh kosong')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Nama tidak boleh kosong');
    expect(screen.queryByText('Wajib diisi')).not.toBeInTheDocument();
  });

  it('label associates with input via htmlFor', () => {
    render(
      <FormField label="Email" htmlFor="email">
        <input id="email" />
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
  });

  it('applies fullSpan class when prop set', () => {
    const { container } = render(
      <FormField label="X" htmlFor="x" fullSpan>
        <input id="x" />
      </FormField>,
    );
    expect(container.firstChild.className).toMatch(/sm:col-span-2/);
  });
});

describe('FormActions', () => {
  it('renders children with right alignment by default', () => {
    const { container } = render(
      <FormActions>
        <button>Batal</button>
        <button>Simpan</button>
      </FormActions>,
    );
    expect(container.firstChild.className).toMatch(/justify-end/);
    expect(screen.getByText('Batal')).toBeInTheDocument();
    expect(screen.getByText('Simpan')).toBeInTheDocument();
  });

  it('supports between alignment', () => {
    const { container } = render(
      <FormActions align="between">
        <button>X</button>
      </FormActions>,
    );
    expect(container.firstChild.className).toMatch(/justify-between/);
  });
});

describe('Input base class constants', () => {
  it('INPUT_BASE_CLASS includes essential focus + size classes', () => {
    expect(INPUT_BASE_CLASS).toMatch(/h-9/);
    expect(INPUT_BASE_CLASS).toMatch(/focus:ring-2/);
    expect(INPUT_BASE_CLASS).toMatch(/border/);
  });

  it('TEXTAREA_BASE_CLASS replaces fixed height with min-height', () => {
    expect(TEXTAREA_BASE_CLASS).toMatch(/min-h-\[80px\]/);
    expect(TEXTAREA_BASE_CLASS).not.toMatch(/h-9/);
  });
});

describe('Full form composition (integration)', () => {
  it('renders a complete form with sections and fields', () => {
    const handleSubmit = jest.fn((e) => e.preventDefault());
    render(
      <form onSubmit={handleSubmit}>
        <FormSection title="Profile" description="Your details">
          <FormGrid>
            <FormField label="First Name" htmlFor="fn" required>
              <input id="fn" defaultValue="John" />
            </FormField>
            <FormField label="Last Name" htmlFor="ln" required>
              <input id="ln" defaultValue="Doe" />
            </FormField>
          </FormGrid>
        </FormSection>
        <FormActions>
          <button type="submit">Save</button>
        </FormActions>
      </form>,
    );
    expect(screen.getByLabelText(/First Name/)).toHaveValue('John');
    expect(screen.getByLabelText(/Last Name/)).toHaveValue('Doe');
    fireEvent.click(screen.getByText('Save'));
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });
});
