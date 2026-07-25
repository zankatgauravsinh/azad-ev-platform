import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from './data-table';

interface Row {
  id: string;
  name: string;
}

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, render: (r) => r.name },
];
const rows: Row[] = [
  { id: '1', name: 'VX1' },
  { id: '2', name: 'VZ1' },
];

describe('DataTable', () => {
  it('renders rows', () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(r) => r.id} />);
    expect(screen.getByText('VX1')).toBeInTheDocument();
    expect(screen.getByText('VZ1')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        emptyState={<p>Nothing here</p>}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('fires onSortChange when a sortable header is clicked', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} onSortChange={onSortChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith('name');
  });

  it('paginates via the footer controls', () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        page={{ page: 1, pageSize: 20, total: 40, totalPages: 2 }}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
