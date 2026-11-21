import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LiteApiIntegrationSettings from '../LiteApiIntegrationSettings';

const api = vi.hoisted(() => ({
  getLiteApi: vi.fn(),
  saveLiteApi: vi.fn(),
  testLiteApi: vi.fn(),
  disconnectLiteApi: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../../services/api', () => ({ integrationAPI: api }));
vi.mock('@/lib/toast', () => ({ default: toast }));

afterEach(() => vi.clearAllMocks());

const disconnected = { connected: false, status: 'disconnected', mode: null, lastFour: null };
const connected = { connected: true, status: 'connected', mode: 'live', lastFour: '6789' };

describe('LiteApiIntegrationSettings', () => {
  it('says hotels stay off until the agency connects LiteAPI', async () => {
    api.getLiteApi.mockResolvedValue({ data: disconnected });

    render(<LiteApiIntegrationSettings />);

    expect(await screen.findByTestId('liteapi-status')).toHaveTextContent('Hotel search and booking stay off until you connect');
  });

  it('sends the pasted key without surrounding spaces', async () => {
    api.getLiteApi.mockResolvedValue({ data: disconnected });
    api.saveLiteApi.mockResolvedValue({ data: connected });
    render(<LiteApiIntegrationSettings />);

    fireEvent.change(await screen.findByLabelText('LiteAPI key'), { target: { value: '  prod_c0ffee12-3456-7890  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect' }));

    await waitFor(() => expect(api.saveLiteApi).toHaveBeenCalledWith({ apiKey: 'prod_c0ffee12-3456-7890' }));
  });

  it('shows the connected account by its last four characters only', async () => {
    api.getLiteApi.mockResolvedValue({ data: connected });

    render(<LiteApiIntegrationSettings />);

    expect(await screen.findByTestId('liteapi-status')).toHaveTextContent('live account, key ending 6789');
  });

  it('warns that a sandbox key makes no real reservations', async () => {
    api.getLiteApi.mockResolvedValue({ data: { ...connected, mode: 'test' } });

    render(<LiteApiIntegrationSettings />);

    expect(await screen.findByText(/sandbox key: bookings are not real reservations/)).toBeInTheDocument();
  });

  it('asks for a new key when the saved one stopped working', async () => {
    api.getLiteApi.mockResolvedValue({ data: { ...disconnected, status: 'error' } });

    render(<LiteApiIntegrationSettings />);

    expect(await screen.findByTestId('liteapi-status')).toHaveTextContent('LiteAPI stopped accepting the saved key');
  });

  it('shows why a key was refused', async () => {
    api.getLiteApi.mockResolvedValue({ data: disconnected });
    api.saveLiteApi.mockRejectedValue({ status: 400, data: { message: 'LiteAPI did not accept this API key.' } });
    render(<LiteApiIntegrationSettings />);

    fireEvent.change(await screen.findByLabelText('LiteAPI key'), { target: { value: 'sand_wrongkey123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('LiteAPI did not accept this API key.'));
  });
});
