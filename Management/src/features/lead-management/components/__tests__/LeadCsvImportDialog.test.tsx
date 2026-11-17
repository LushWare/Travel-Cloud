import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { previewCsvImport } = vi.hoisted(() => ({ previewCsvImport: vi.fn() }));
vi.mock('../../../../services/api', () => ({ leadAPI: { previewCsvImport, importCsvRows: vi.fn() } }));
vi.mock('@/lib/toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import LeadCsvImportDialog from '../LeadCsvImportDialog';

afterEach(() => vi.clearAllMocks());

const preview = async () => {
  const user = userEvent.setup();
  render(<LeadCsvImportDialog open onOpenChange={vi.fn()} onImported={vi.fn()} />);
  const file = new File(['id,name\n1,Alex'], 'leads.csv', { type: 'text/csv' });
  // jsdom's File has no text(); the dialog reads the file with it.
  Object.defineProperty(file, 'text', { value: async () => 'id,name\n1,Alex' });
  await user.upload(screen.getByLabelText('CSV file'), file);
  await user.click(screen.getByRole('button', { name: /Preview/ }));
};

describe('LeadCsvImportDialog', () => {
  it('lists the columns that will not be imported', async () => {
    previewCsvImport.mockResolvedValue({ data: {
      totalRows: 1, validCount: 1, invalidCount: 0, ignoredColumns: ['id', 'google_place_id'],
      rows: [{ rowNumber: 2, data: { name: 'Alex' }, errors: [] }],
    } });

    await preview();

    expect(await screen.findByTestId('csv-ignored-columns')).toHaveTextContent("Not imported (2 columns we don't use): id, google_place_id");
  });

  it('says nothing about skipped columns when every column is used', async () => {
    previewCsvImport.mockResolvedValue({ data: {
      totalRows: 1, validCount: 1, invalidCount: 0, ignoredColumns: [],
      rows: [{ rowNumber: 2, data: { name: 'Alex' }, errors: [] }],
    } });

    await preview();

    await screen.findByText(/1 ready to import/);
    expect(screen.queryByTestId('csv-ignored-columns')).not.toBeInTheDocument();
  });
});
