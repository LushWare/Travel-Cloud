import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LeadStatusBadge, { LIFECYCLE_STATUS_LABELS, LIFECYCLE_STATUS_COLORS } from '../LeadStatusBadge';

describe('LeadStatusBadge — PENDING_VERIFICATION', () => {
  it('renders Needs Rep Attention for a PENDING_VERIFICATION status', () => {
    render(<LeadStatusBadge status="PENDING_VERIFICATION" />);
    expect(screen.getByText('Needs Rep Attention')).toBeInTheDocument();
  });

  it('maps PENDING_VERIFICATION to the attention label', () => {
    expect(LIFECYCLE_STATUS_LABELS['PENDING_VERIFICATION']).toBe('Needs Rep Attention');
  });

  it('uses a distinct warning token color (not the muted NEW color)', () => {
    const pending = LIFECYCLE_STATUS_COLORS['PENDING_VERIFICATION'];
    expect(pending).not.toBe(LIFECYCLE_STATUS_COLORS['NEW']);
    expect(pending).toContain('bg-warning');
  });
});
