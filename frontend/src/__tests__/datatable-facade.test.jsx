/**
 * DataTable Facade Tests — TD-013 (Session #11.13)
 * =================================================
 * Validates that the v1 DataTable facade correctly delegates to v2 when no
 * legacy-specific features are used, and falls back to the native v1
 * implementation when expandedRow or onSearch is provided.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DataTable from '../components/erp/DataTable';

// Lightweight mock of DataTableV2 to inspect prop delegation.
// jest.mock() factory is hoisted — declare spy via mockImplementation later.
jest.mock('../components/erp/DataTableV2', () => ({
  __esModule: true,
  DataTable: jest.fn(),
}));
// Import the mock and configure it AFTER imports complete
import { DataTable as DataTableV2Mock } from '../components/erp/DataTableV2';

beforeEach(() => {
  DataTableV2Mock.mockClear();
  DataTableV2Mock.mockImplementation((props) => {
    const { rows, columns, tableId, toolbar, exportFn } = props;
    return (
      <div data-testid="dt-v2-mock" data-table-id={tableId}>
        <span data-testid="dt-v2-row-count">{rows ? rows.length : 0}</span>
        <span data-testid="dt-v2-col-count">{columns ? columns.length : 0}</span>
        {toolbar && <div data-testid="dt-v2-toolbar">{toolbar}</div>}
        {exportFn && <button data-testid="dt-v2-export" onClick={() => exportFn([])}>export</button>}
      </div>
    );
  });
});

describe('DataTable (v1 facade)', () => {
  const sampleColumns = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name', render: (value, row) => `[${row.id}] ${value}` },
  ];
  const sampleData = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ];

  describe('delegation to v2', () => {
    it('delegates to v2 when no legacy props are used', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          title="Users"
          searchKeys={['name']}
        />,
      );
      expect(screen.getByTestId('dt-v2-mock')).toBeInTheDocument();
      expect(screen.getByTestId('dt-v2-row-count')).toHaveTextContent('2');
      expect(screen.getByTestId('dt-v2-col-count')).toHaveTextContent('2');
    });

    it('flips render arg order (v1 (value, row) → v2 (row, value)) via adapter', () => {
      render(<DataTable columns={sampleColumns} data={sampleData} />);
      const v2Cols = DataTableV2Mock.mock.calls[DataTableV2Mock.mock.calls.length - 1][0].columns;
      const adapted = v2Cols.find((c) => c.key === 'name');
      expect(adapted.render).toBeDefined();
      // v2 calls render(row, value); adapter calls original(value, row)
      const result = adapted.render({ id: 7, name: 'Charlie' }, 'Charlie');
      expect(result).toBe('[7] Charlie');
    });

    it('translates exportData → exportFn (which drops the rows arg)', () => {
      const exportData = jest.fn();
      render(<DataTable columns={sampleColumns} data={sampleData} exportData={exportData} />);
      fireEvent.click(screen.getByTestId('dt-v2-export'));
      expect(exportData).toHaveBeenCalledTimes(1);
      expect(exportData).toHaveBeenCalledWith();
    });

    it('translates actions → toolbar', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          actions={<button>Add</button>}
        />,
      );
      expect(screen.getByTestId('dt-v2-toolbar')).toBeInTheDocument();
      expect(screen.getByText('Add')).toBeInTheDocument();
    });

    it('generates a stable tableId from title when not provided', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          title="My Users Table"
        />,
      );
      const id = screen.getByTestId('dt-v2-mock').getAttribute('data-table-id');
      expect(id).toMatch(/^legacy-my-users-table/);
    });
  });

  describe('legacy escape hatch', () => {
    it('keeps native v1 implementation when expandedRow is provided', () => {
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          expandedRow={(row) => <div>Expanded {row.id}</div>}
        />,
      );
      // v2 mock should NOT be rendered
      expect(screen.queryByTestId('dt-v2-mock')).not.toBeInTheDocument();
      // Original column header should render
      expect(screen.getByText('ID')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
      // expandedRow content should be present
      expect(screen.getByText('Expanded 1')).toBeInTheDocument();
      expect(screen.getByText('Expanded 2')).toBeInTheDocument();
    });

    it('keeps native v1 implementation when onSearch is provided', () => {
      const onSearch = jest.fn();
      render(
        <DataTable
          columns={sampleColumns}
          data={sampleData}
          onSearch={onSearch}
        />,
      );
      // v2 mock should NOT be rendered
      expect(screen.queryByTestId('dt-v2-mock')).not.toBeInTheDocument();
      // Native search field present
      const searchInput = screen.getByPlaceholderText('Cari...');
      expect(searchInput).toBeInTheDocument();
      fireEvent.change(searchInput, { target: { value: 'foo' } });
      expect(onSearch).toHaveBeenCalledWith('foo');
    });
  });
});
