import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DuffelIntegrationSettings from '../DuffelIntegrationSettings';

const api = vi.hoisted(() => ({
  getDuffel: vi.fn(),
  saveDuffel: vi.fn(),
  testDuffel: vi.fn(),
  disconnectDuffel: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('../../services/api', () => ({ integrationAPI: api }));
vi.mock('@/lib/toast', () => ({ default: toast }));

afterEach(() => vi.clearAllMocks());

const disconnected = { connected: false, status: 'disconnected', mode: null, lastFour: null, bookingUpdates: 'off' };
const connected = { connected: true, status: 'connected', mode: 'live', lastFour: 'a1b2', bookingUpdates: 'on', bookingUpdatesNote: null };

describe('DuffelIntegrationSettings', () => {
  it('says flights stay off until the agency connects Duffel', async () => {
    api.getDuffel.mockResolvedValue({ data: disconnected });

    render(<DuffelIntegrationSettings />);

    expect(await screen.findByTestId('duffel-status')).toHaveTextContent('Flight search and booking stay off until you connect');
  });

  it('sends the pasted token and shows the connected account', async () => {
    api.getDuffel.mockResolvedValue({ data: disconnected });
    api.saveDuffel.mockResolvedValue({ data: connected });
    render(<DuffelIntegrationSettings />);
    const input = await screen.findByLabelText('Duffel access token');

    fireEvent.change(input, { target: { value: '  duffel_live_abcdefghijklmnop  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect' }));

    await waitFor(() => expect(api.saveDuffel).toHaveBeenCalledWith({ accessToken: 'duffel_live_abcdefghijklmnop' }));
    expect(await screen.findByTestId('duffel-status')).toHaveTextContent('live account, token ending a1b2');
  });

  it('clears the token from the form after saving', async () => {
    api.getDuffel.mockResolvedValue({ data: disconnected });
    api.saveDuffel.mockResolvedValue({ data: connected });
    render(<DuffelIntegrationSettings />);
    const input = await screen.findByLabelText('Duffel access token');

    fireEvent.change(input, { target: { value: 'duffel_live_abcdefghijklmnop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect' }));

    await waitFor(() => expect(screen.getByLabelText('Replace access token')).toHaveValue(''));
  });

  it("shows Duffel's reason when the token is refused", async () => {
    api.getDuffel.mockResolvedValue({ data: disconnected });
    api.saveDuffel.mockRejectedValue({ status: 400, data: { message: 'Duffel did not accept this access token.' } });
    render(<DuffelIntegrationSettings />);

    fireEvent.change(await screen.findByLabelText('Duffel access token'), { target: { value: 'duffel_test_abcdefghijklmnop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test and connect' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Duffel did not accept this access token.'));
  });

  it('explains why automatic booking updates are off', async () => {
    api.getDuffel.mockResolvedValue({ data: { ...connected, bookingUpdates: 'off', bookingUpdatesNote: 'Remove the existing webhook in your Duffel dashboard.' } });

    render(<DuffelIntegrationSettings />);

    expect(await screen.findByTestId('duffel-booking-updates')).toHaveTextContent('Automatic booking updates: Off · Remove the existing webhook');
  });

  it('warns that a test token does not issue real tickets', async () => {
    api.getDuffel.mockResolvedValue({ data: { ...connected, mode: 'test' } });

    render(<DuffelIntegrationSettings />);

    expect(await screen.findByText(/bookings are not real tickets/)).toBeInTheDocument();
  });

  it('disconnects the account', async () => {
    api.getDuffel.mockResolvedValue({ data: connected });
    api.disconnectDuffel.mockResolvedValue({ data: disconnected });
    render(<DuffelIntegrationSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByTestId('duffel-status')).toHaveTextContent('Not connected');
  });
});
