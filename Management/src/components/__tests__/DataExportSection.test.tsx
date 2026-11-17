import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockAuth, exportAgencyData } = vi.hoisted(() => ({ mockAuth: vi.fn(), exportAgencyData: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: mockAuth }));
vi.mock('../../services/api', () => ({ adminAPI: { exportAgencyData } }));

import DataExportSection from '../DataExportSection';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:export');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.clearAllMocks());

describe('DataExportSection', () => {
  it('downloads the ZIP for the agency owner', async () => {
    mockAuth.mockReturnValue({ user: { role: 'superAdmin', isSuperAdmin: true } });
    exportAgencyData.mockResolvedValue(new Blob(['zip']));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DataExportSection />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download all data' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  });

  it('tells the owner the download has started and the file name', async () => {
    mockAuth.mockReturnValue({ user: { role: 'superAdmin', isSuperAdmin: true } });
    exportAgencyData.mockResolvedValue(new Blob(['zip']));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DataExportSection />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download all data' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Download started: agency-data-\d{4}-\d{2}-\d{2}\.zip/);
  });

  it('keeps the file link alive while the browser starts the download', async () => {
    mockAuth.mockReturnValue({ user: { role: 'superAdmin', isSuperAdmin: true } });
    exportAgencyData.mockResolvedValue(new Blob(['zip']));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DataExportSection />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download all data' }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('shows the reason when the export fails', async () => {
    mockAuth.mockReturnValue({ user: { role: 'superAdmin', isSuperAdmin: true } });
    exportAgencyData.mockRejectedValue({ status: 429, data: { message: 'An export is already being prepared. Try again in a minute.' } });
    render(<DataExportSection />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Download all data' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An export is already being prepared');
  });

  it('is not offered to an admin who is not the owner', () => {
    mockAuth.mockReturnValue({ user: { role: 'admin', isSuperAdmin: false } });

    const { container } = render(<DataExportSection />);

    expect(container).toBeEmptyDOMElement();
  });

  it('is not offered during Lushware support access', () => {
    mockAuth.mockReturnValue({ user: { role: 'superAdmin', isSuperAdmin: true, helpAccess: { viewOnly: true } } });

    const { container } = render(<DataExportSection />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('DataExportSection for an owner whose session lacks the owner flag', () => {
  it('is offered to role superAdmin', () => {
    mockAuth.mockReturnValue({ user: { role: 'superAdmin' } });

    render(<DataExportSection />);

    expect(screen.getByRole('button', { name: 'Download all data' })).toBeInTheDocument();
  });
});
