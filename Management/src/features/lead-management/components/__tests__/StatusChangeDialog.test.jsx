import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatusChangeDialog from '../StatusChangeDialog';

function renderDialog(props = {}) {
  return render(
    <StatusChangeDialog
      isOpen
      onClose={vi.fn()}
      lead={{ name: 'Chat Lead', lifecycleStatus: 'PENDING_VERIFICATION' }}
      onStatusChange={vi.fn()}
      {...props}
    />
  );
}

describe('StatusChangeDialog — free status changes', () => {
  it('shows every lifecycle status and only disables the current status', () => {
    renderDialog();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Needs Rep Attention')).toBeInTheDocument();
    expect(screen.getByText('Drafting')).toBeInTheDocument();
    expect(screen.getByText('Quoted')).toBeInTheDocument();
    expect(screen.getByText('Revision')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Booking')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    expect(screen.queryByText('Booking Failed')).not.toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('New').closest('button')).toBeEnabled();
    expect(screen.getByText('Drafting').closest('button')).toBeEnabled();
    expect(screen.getByText('Confirmed').closest('button')).toBeEnabled();
    expect(screen.getByText('Needs Rep Attention').closest('button')).toBeDisabled();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.queryByText(/does not create a quote, payment, or booking/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Fresh lead, not yet drafted')).not.toBeInTheDocument();
  });

  it('allows Revision from Quoted', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    renderDialog({
      lead: { name: 'Chat Lead', lifecycleStatus: 'QUOTED' },
      onStatusChange,
    });

    const revisionStatus = screen.getByText('Revision').closest('button');
    expect(revisionStatus).toBeEnabled();
    await user.click(revisionStatus);
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(onStatusChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycleStatus: 'QUOTED' }),
      'REVISION',
      undefined
    );
  });

  it('allows a drafted lead to move directly to any status', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    renderDialog({
      lead: { name: 'Chat Lead', lifecycleStatus: 'DRAFTING' },
      onStatusChange,
    });

    const newStatus = screen.getByText('New').closest('button');
    expect(newStatus).toBeEnabled();
    expect(screen.getByText('Confirmed').closest('button')).toBeEnabled();

    await user.click(newStatus);
    expect(onStatusChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycleStatus: 'DRAFTING' }),
      'NEW',
      undefined,
    );
  });

  it('claims the lead only after confirming the New status', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    renderDialog({ onStatusChange });

    await user.click(screen.getByText('New'));
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(onStatusChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Chat Lead', lifecycleStatus: 'PENDING_VERIFICATION' }),
      'NEW',
      undefined
    );
  });

  it('returns to the status choices when confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    renderDialog({ onStatusChange });

    await user.click(screen.getByText('New'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('asks for a loss reason only after Closed Lost is selected', async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    renderDialog({ onStatusChange });

    expect(screen.queryByText('Loss Reason')).not.toBeInTheDocument();
    await user.click(screen.getByText('Lost'));
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('Loss Reason')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm Closed Lost' })).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Why was this lead lost?'), 'Customer declined');
    await user.click(screen.getByRole('button', { name: 'Confirm Closed Lost' }));
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Chat Lead', lifecycleStatus: 'PENDING_VERIFICATION' }),
      'CLOSED_LOST',
      'Customer declined'
    );
  });
});
