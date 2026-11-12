import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SupportAccessNote from '../SupportAccessNote';

vi.mock('../../services/api', () => ({ adminAPI: { getSupportAccess: vi.fn() } }));
import { adminAPI } from '../../services/api';

afterEach(() => vi.clearAllMocks());

describe('SupportAccessNote', () => {
  it('lists a Lushware support visit with its length and reason', async () => {
    vi.mocked(adminAPI.getSupportAccess).mockResolvedValue({
      data: [{ id: 'v1', startedAt: '2026-11-12T10:30:00.000Z', minutes: 15, reason: 'Help with invoice PDF' }],
    });

    render(<SupportAccessNote />);

    expect(await screen.findByText('Reason: Help with invoice PDF')).toBeInTheDocument();
    expect(screen.getByText(/view-only, up to 15 minutes/)).toBeInTheDocument();
  });

  it('says support has never viewed the account when there are no visits', async () => {
    vi.mocked(adminAPI.getSupportAccess).mockResolvedValue({ data: [] });

    render(<SupportAccessNote />);

    expect(await screen.findByText('Lushware support has never viewed your account.')).toBeInTheDocument();
  });

  it('shows nothing, rather than an error, when the visits cannot be loaded', async () => {
    vi.mocked(adminAPI.getSupportAccess).mockRejectedValue(new Error('offline'));

    const { container } = render(<SupportAccessNote />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container).toBeEmptyDOMElement();
  });
});
