import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetCallsForLead = vi.fn();
const mockVerifyAiLead = vi.fn();
const mockGetPackageSelections = vi.fn();
const mockApproveAiChange = vi.fn();
const mockRefreshPackageSelection = vi.fn();
const mockGetRelatedLeads = vi.fn();

vi.mock('@/services/api', () => ({
  voiceAPI: {
    getCallsForLead: (...a) => mockGetCallsForLead(...a),
    recordingUrl: (id) => `/api/v1/voice/calls/${id}/recording`,
  },
  leadAPI: {
    verifyAiLead: (...a) => mockVerifyAiLead(...a),
    getPackageSelections: (...a) => mockGetPackageSelections(...a),
    approveAiChange: (...a) => mockApproveAiChange(...a),
    refreshPackageSelection: (...a) => mockRefreshPackageSelection(...a),
    getRelatedLeads: (...a) => mockGetRelatedLeads(...a),
  },
}));

const { default: LeadAiCallsTab, formatDuration, describeAction } = await import('../LeadAiCallsTab');
const { formatTripDates } = await import('../RelatedLeadsCard');

const lead = { id: '11111111-1111-1111-1111-111111111111', aiHandled: true };

const call = (over = {}) => ({
  id: 'vc-1',
  startedAt: '2026-09-10T10:00:00.000Z',
  durationSec: 200,
  disposition: 'COMPLETED',
  matchOutcome: 'MATCHED',
  needsRepFollowup: false,
  summary: 'New Maldives enquiry',
  sentiment: 'Positive',
  transcript: [
    { sequence: 0, role: 'assistant', content: 'Thanks for calling.' },
    { sequence: 1, role: 'user', content: 'Maldives in December please.' },
  ],
  hasRecording: true,
  actions: [{ sequence: 0, functionName: 'attach_package', succeeded: true, createdAt: '2026-09-10T10:01:00.000Z' }],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCallsForLead.mockResolvedValue({ data: [call()] });
  mockVerifyAiLead.mockResolvedValue({ success: true });
  // No unreviewed AI edit by default — the approval-card tests opt in.
  mockGetPackageSelections.mockResolvedValue({ data: [] });
  mockApproveAiChange.mockResolvedValue({ success: true });
  mockRefreshPackageSelection.mockResolvedValue({ success: true });
  // No other lead on this number by default — the repeat-caller tests opt in.
  mockGetRelatedLeads.mockResolvedValue({ data: { count: 0, related: [] } });
});

describe('LeadAiCallsTab', () => {
  it('shows an empty state when the lead has no AI calls', async () => {
    mockGetCallsForLead.mockResolvedValue({ data: [] });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('No AI calls on this lead')).toBeInTheDocument();
  });

  it('shows an error with a retry when the call history fails to load', async () => {
    mockGetCallsForLead.mockRejectedValue(new Error('boom'));
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Could not load call history.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders the AI summary for a call', async () => {
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('New Maldives enquiry')).toBeInTheDocument();
  });

  it('numbers calls newest-first so the oldest call is Call 1', async () => {
    mockGetCallsForLead.mockResolvedValue({
      data: [call({ id: 'vc-3' }), call({ id: 'vc-2' }), call({ id: 'vc-1' })],
    });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Call 3')).toBeInTheDocument();
    expect(screen.getByText('Call 1')).toBeInTheDocument();
  });

  it('keeps the transcript hidden until the call is expanded', async () => {
    render(<LeadAiCallsTab lead={lead} />);
    await screen.findByText('New Maldives enquiry');
    expect(screen.queryByText('Maldives in December please.')).not.toBeInTheDocument();
  });

  it('reveals the transcript when the call is expanded', async () => {
    render(<LeadAiCallsTab lead={lead} />);
    await userEvent.click(await screen.findByRole('button', { name: /Details/ }));
    expect(screen.getByText('Maldives in December please.')).toBeInTheDocument();
  });

  it('lists what the AI did in plain language when expanded', async () => {
    render(<LeadAiCallsTab lead={lead} />);
    await userEvent.click(await screen.findByRole('button', { name: /Details/ }));
    expect(screen.getByText('Attach package')).toBeInTheDocument();
  });

  it('flags a call whose number matched several leads', async () => {
    mockGetCallsForLead.mockResolvedValue({ data: [call({ matchOutcome: 'AMBIGUOUS' })] });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Shared number')).toBeInTheDocument();
  });

  it('shows a red warning when an exact-package booking needs rep review', async () => {
    render(<LeadAiCallsTab lead={{ ...lead, voiceNeedsRepReview: true }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Package/price change needs review');
  });

  it('marks the lead as checked when the rep confirms', async () => {
    const onVerified = vi.fn();
    render(<LeadAiCallsTab lead={lead} onVerified={onVerified} />);
    await userEvent.click(await screen.findByRole('button', { name: /Mark as checked/ }));
    await waitFor(() => expect(mockVerifyAiLead).toHaveBeenCalledWith(lead.id));
    expect(onVerified).toHaveBeenCalled();
  });

  it('hides the verify action for an already verified lead', async () => {
    render(<LeadAiCallsTab lead={{ ...lead, aiVerifiedAt: '2026-09-10T12:00:00.000Z' }} />);
    await screen.findByText('New Maldives enquiry');
    expect(screen.queryByRole('button', { name: /Mark as checked/ })).not.toBeInTheDocument();
  });
});

describe('the approve-or-discard card for an unreviewed AI edit', () => {
  const pendingSelection = (over = {}) => ({
    id: 'sel-1',
    packageName: 'Maldives 5N',
    pendingAiChange: {
      before: { nights: 3, hotel: 'Old Resort', destination: 'Maldives' },
      after: { nights: 5, hotel: 'Old Resort', destination: 'Maldives' },
      summary: 'Added 2 nights',
      changedAt: '2026-09-11T09:00:00.000Z',
    },
    ...over,
  });

  it('is not shown when no selection has a pending change', async () => {
    mockGetPackageSelections.mockResolvedValue({ data: [{ id: 'sel-1', pendingAiChange: null }] });
    render(<LeadAiCallsTab lead={lead} />);
    await screen.findByText('New Maldives enquiry');
    expect(screen.queryByText('The voice agent changed this itinerary')).not.toBeInTheDocument();
  });

  it('shows what the agent changed, in plain language', async () => {
    mockGetPackageSelections.mockResolvedValue({ data: [pendingSelection()] });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Added 2 nights')).toBeInTheDocument();
  });

  it('shows the old and new night count side by side', async () => {
    mockGetPackageSelections.mockResolvedValue({ data: [pendingSelection()] });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('3 nights')).toBeInTheDocument();
    expect(screen.getByText('5 nights')).toBeInTheDocument();
  });

  it('hides a row for a field the agent did not change', async () => {
    mockGetPackageSelections.mockResolvedValue({ data: [pendingSelection()] });
    render(<LeadAiCallsTab lead={lead} />);
    await screen.findByText('Added 2 nights');
    // Hotel and destination are identical before/after in this fixture.
    expect(screen.queryByText('Hotel')).not.toBeInTheDocument();
    expect(screen.queryByText('Destination')).not.toBeInTheDocument();
  });

  it('shows a hotel change when that is what the agent altered', async () => {
    mockGetPackageSelections.mockResolvedValue({
      data: [pendingSelection({
        pendingAiChange: {
          before: { nights: 3, hotel: 'Old Resort', destination: 'Maldives' },
          after: { nights: 3, hotel: 'Sunset Bay', destination: 'Maldives' },
          summary: 'Changed hotel to Sunset Bay',
          changedAt: '2026-09-11T09:00:00.000Z',
        },
      })],
    });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Sunset Bay')).toBeInTheDocument();
    expect(screen.getByText('Old Resort')).toBeInTheDocument();
  });

  it('approves the change through the approve endpoint', async () => {
    mockGetPackageSelections.mockResolvedValue({ data: [pendingSelection()] });
    render(<LeadAiCallsTab lead={lead} />);
    await userEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(mockApproveAiChange).toHaveBeenCalledWith(lead.id, 'sel-1'));
  });

  it('discards the change by reverting the draft to the original package', async () => {
    mockGetPackageSelections.mockResolvedValue({ data: [pendingSelection()] });
    render(<LeadAiCallsTab lead={lead} />);
    await userEvent.click(await screen.findByRole('button', { name: /Discard/ }));
    await waitFor(() => expect(mockRefreshPackageSelection).toHaveBeenCalledWith(lead.id, 'sel-1', true));
  });

  it('is still shown when the call history fails to load', async () => {
    mockGetCallsForLead.mockRejectedValue(new Error('voice-service down'));
    mockGetPackageSelections.mockResolvedValue({ data: [pendingSelection()] });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Added 2 nights')).toBeInTheDocument();
  });

  it('is still shown when the lead has no stored calls at all', async () => {
    mockGetCallsForLead.mockResolvedValue({ data: [] });
    mockGetPackageSelections.mockResolvedValue({ data: [pendingSelection()] });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Added 2 nights')).toBeInTheDocument();
  });

  it('does not blank the call history when the pending-change lookup fails', async () => {
    mockGetPackageSelections.mockRejectedValue(new Error('lead-service down'));
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('New Maldives enquiry')).toBeInTheDocument();
  });
});

describe('the repeat-caller panel', () => {
  const related = (over = {}) => ({
    id: 'lead-old-1',
    name: 'Nimal Perera',
    destination: 'Maldives',
    lifecycleStatus: 'CONFIRMED',
    travelDate: '2019-01-01T00:00:00.000Z',
    endDate: '2019-01-08T00:00:00.000Z',
    createdAt: '2018-12-01T00:00:00.000Z',
    aiHandled: false,
    recency: 'PAST',
    ...over,
  });

  it('is not shown when no other lead shares the number', async () => {
    render(<LeadAiCallsTab lead={lead} />);
    await screen.findByText('New Maldives enquiry');
    expect(screen.queryByText(/Repeat caller/)).not.toBeInTheDocument();
  });

  it('tells the rep how many other leads share the number', async () => {
    mockGetRelatedLeads.mockResolvedValue({
      data: { count: 2, related: [related(), related({ id: 'lead-old-2' })] },
    });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Repeat caller — 2 other leads on this number')).toBeInTheDocument();
  });

  it('uses the singular wording for exactly one other lead', async () => {
    mockGetRelatedLeads.mockResolvedValue({ data: { count: 1, related: [related()] } });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('Repeat caller — 1 other lead on this number')).toBeInTheDocument();
  });

  it('splits the count into still-running and finished trips', async () => {
    mockGetRelatedLeads.mockResolvedValue({
      data: {
        count: 3,
        related: [
          related({ id: 'a', recency: 'LIVE' }),
          related({ id: 'b', recency: 'PAST' }),
          related({ id: 'c', recency: 'PAST' }),
        ],
      },
    });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('1 still running · 2 finished')).toBeInTheDocument();
  });

  it('keeps the individual leads hidden until the panel is opened', async () => {
    mockGetRelatedLeads.mockResolvedValue({ data: { count: 1, related: [related()] } });
    render(<LeadAiCallsTab lead={lead} />);
    await screen.findByText(/Repeat caller/);
    expect(screen.queryByText('Finished')).not.toBeInTheDocument();
  });

  it('marks a past trip as finished once the panel is opened', async () => {
    mockGetRelatedLeads.mockResolvedValue({ data: { count: 1, related: [related()] } });
    render(<LeadAiCallsTab lead={lead} />);
    await userEvent.click(await screen.findByRole('button', { name: /Show/ }));
    expect(screen.getByText('Finished')).toBeInTheDocument();
  });

  it('marks an upcoming trip as still running once the panel is opened', async () => {
    mockGetRelatedLeads.mockResolvedValue({ data: { count: 1, related: [related({ recency: 'LIVE' })] } });
    render(<LeadAiCallsTab lead={lead} />);
    await userEvent.click(await screen.findByRole('button', { name: /Show/ }));
    expect(screen.getByText('Still running')).toBeInTheDocument();
  });

  it('is still shown when the lead has no stored calls at all', async () => {
    mockGetCallsForLead.mockResolvedValue({ data: [] });
    mockGetRelatedLeads.mockResolvedValue({ data: { count: 1, related: [related()] } });
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText(/Repeat caller/)).toBeInTheDocument();
  });

  it('does not blank the call history when the related-lead lookup fails', async () => {
    mockGetRelatedLeads.mockRejectedValue(new Error('lead-service down'));
    render(<LeadAiCallsTab lead={lead} />);
    expect(await screen.findByText('New Maldives enquiry')).toBeInTheDocument();
  });
});

describe('formatTripDates', () => {
  it('renders a range when both dates are known', () => {
    const text = formatTripDates('2026-12-01T00:00:00.000Z', '2026-12-08T00:00:00.000Z');
    expect(text).toContain('–');
  });

  it('renders a single date when only the start is known', () => {
    const text = formatTripDates('2026-12-01T00:00:00.000Z', null);
    expect(text).not.toContain('–');
  });

  it('says so plainly when the trip carries no dates', () => {
    expect(formatTripDates(null, null)).toBe('No dates');
  });
});

describe('formatDuration', () => {
  it('renders minutes and seconds for a call over a minute', () => {
    expect(formatDuration(200)).toBe('3m 20s');
  });

  it('renders seconds only for a short call', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('renders a dash when the duration is unknown', () => {
    expect(formatDuration(null)).toBe('—');
  });
});

describe('describeAction', () => {
  it('turns a function name into readable text', () => {
    expect(describeAction('attach_package')).toBe('Attach package');
  });
});
