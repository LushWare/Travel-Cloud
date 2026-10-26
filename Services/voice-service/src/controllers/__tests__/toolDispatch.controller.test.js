import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVoiceCallFindUnique = vi.fn();
const mockVoiceCallEventCreate = vi.fn();
const mockVoiceCallEventCount = vi.fn();
vi.mock('../../db/client.js', () => ({
  default: {
    voiceCall: { findUnique: (...a) => mockVoiceCallFindUnique(...a) },
    voiceCallEvent: {
      create: (...a) => mockVoiceCallEventCreate(...a),
      count: (...a) => mockVoiceCallEventCount(...a),
    },
  },
}));

const mockSearchPackages = vi.fn();
vi.mock('../../services/package.client.js', () => ({
  searchPackages: (...a) => mockSearchPackages(...a),
}));

const mockGetTripBrief = vi.fn();
const mockGetPaymentBrief = vi.fn();
const mockAttachPackage = vi.fn();
const mockAdjustItinerary = vi.fn();
const mockPreviewPricing = vi.fn();
vi.mock('../../services/lead.client.js', () => ({
  getTripBrief: (...a) => mockGetTripBrief(...a),
  getPaymentBrief: (...a) => mockGetPaymentBrief(...a),
  attachPackage: (...a) => mockAttachPackage(...a),
  adjustItinerary: (...a) => mockAdjustItinerary(...a),
  previewPricing: (...a) => mockPreviewPricing(...a),
}));

const mockGetLatestSentDocument = vi.fn();
const mockResendDocument = vi.fn();
vi.mock('../../services/billing.client.js', () => ({
  getLatestSentDocument: (...a) => mockGetLatestSentDocument(...a),
  resendDocument: (...a) => mockResendDocument(...a),
}));

const {
  searchPackagesTool, getTripStatusTool, getPaymentStatusTool,
  attachPackageTool, adjustItineraryTool, previewPriceTool, resendDocumentTool,
} = await import('../toolDispatch.controller.js');

const res = () => ({ json: vi.fn() });
const next = vi.fn();
const reqWith = (body, conversationId) => ({
  body,
  requestId: 'req-1',
  log: { error: vi.fn() },
  get: (name) => name === 'x-elevenlabs-conversation-id'
    ? conversationId ?? body?.system__conversation_id ?? body?.conversation_id ?? body?.call?.call_id
    : undefined,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockVoiceCallEventCreate.mockResolvedValue({});
  mockVoiceCallEventCount.mockResolvedValue(0);
});

describe('search_packages — needs no active lead', () => {
  it('returns results for a query with no call context at all', async () => {
    mockSearchPackages.mockResolvedValue([{ packageId: 'p1', title: 'Maldives 5N' }]);
    const r = res();
    await searchPackagesTool(reqWith({ args: { query: 'maldives' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ count: 1, packages: [{ packageId: 'p1', title: 'Maldives 5N' }] });
  });
});

describe('lead-bound tools — never trust an id from args', () => {
  it('gets the conversation id from the provider header, not tool arguments', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-real', disposition: 'IN_PROGRESS' });
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    await getTripStatusTool(reqWith({ args: { conversation_id: 'untrusted' } }, 'conv_trusted'), res(), next);
    expect(mockVoiceCallFindUnique).toHaveBeenCalledWith({ where: { conversationId: 'conv_trusted' } });
    expect(mockGetTripBrief).toHaveBeenCalledWith('lead-real', 'req-1');
  });

  it('get_trip_status resolves the lead from the call record, ignoring any lead id in args', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-real', disposition: 'IN_PROGRESS' });
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    await getTripStatusTool(reqWith({
      call: { call_id: 'call_1' },
      args: { leadId: 'lead-attacker-supplied', lead_id: 'also-attacker-supplied' },
    }), res(), next);
    expect(mockGetTripBrief).toHaveBeenCalledWith('lead-real', 'req-1');
  });

  it('get_trip_status reports unavailable when the call has no bound lead', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: null, disposition: 'IN_PROGRESS' });
    const r = res();
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ available: false });
    expect(mockGetTripBrief).not.toHaveBeenCalled();
  });

  it('get_trip_status reports unavailable when no call id is present at all', async () => {
    const r = res();
    await getTripStatusTool(reqWith({ args: {} }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ available: false });
    expect(mockVoiceCallFindUnique).not.toHaveBeenCalled();
  });

  it('attach_package resolves the lead from the call, never from args', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-real', disposition: 'IN_PROGRESS' });
    mockAttachPackage.mockResolvedValue({ selectionId: 'sel-1' });
    await attachPackageTool(reqWith({
      call: { call_id: 'call_1' },
      args: { package_id: 'pkg-9', lead_id: 'lead-attacker-supplied', trip_confirmed: true },
    }), res(), next);
    expect(mockAttachPackage).toHaveBeenCalledWith('lead-real', 'pkg-9', 'req-1');
  });
});

describe('attach_package / adjust_itinerary — trip confirmation is required', () => {
  it('attach_package refuses when trip_confirmed is not explicitly true', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    const r = res();
    await attachPackageTool(reqWith({ call: { call_id: 'call_1' }, args: { package_id: 'pkg-1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ attached: false, reason: 'trip_not_confirmed' });
    expect(mockAttachPackage).not.toHaveBeenCalled();
  });

  it('adjust_itinerary refuses when trip_confirmed is not explicitly true', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    const r = res();
    await adjustItineraryTool(reqWith({ call: { call_id: 'call_1' }, args: { add_nights: 2 } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ adjusted: false, reason: 'trip_not_confirmed' });
    expect(mockAdjustItinerary).not.toHaveBeenCalled();
  });
});

describe('get_payment_status — money gating', () => {
  it('passes through hasQuote:false untouched — the gate lives in lead-service, this only relays it', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetPaymentBrief.mockResolvedValue({ hasQuote: false });
    const r = res();
    await getPaymentStatusTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ available: true, hasQuote: false });
  });
});

describe('attach_package — argument validation', () => {
  it('refuses when no package_id is given', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    const r = res();
    await attachPackageTool(reqWith({ call: { call_id: 'call_1' }, args: { trip_confirmed: true } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ attached: false, reason: 'missing_package_id' });
    expect(mockAttachPackage).not.toHaveBeenCalled();
  });
});

describe('adjust_itinerary — argument mapping', () => {
  it('maps add_nights/remove_nights/hotel_name/destination to the internal shape', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockAdjustItinerary.mockResolvedValue({ nights: 5 });
    await adjustItineraryTool(reqWith({
      call: { call_id: 'call_1' },
      args: { add_nights: 2, hotel_name: '  Sunset Bay  ', destination: 'Bali', trip_confirmed: true },
    }), res(), next);
    expect(mockAdjustItinerary).toHaveBeenCalledWith('lead-1', {
      addNights: 2, hotelName: 'Sunset Bay', destination: 'Bali',
    }, 'req-1');
  });

  it('refuses when none of the recognised arguments are present', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    const r = res();
    await adjustItineraryTool(reqWith({ call: { call_id: 'call_1' }, args: { trip_confirmed: true } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ adjusted: false, reason: 'no_changes_given' });
  });

  it('ignores a non-string hotel_name rather than passing it through', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockAdjustItinerary.mockResolvedValue({ nights: 3 });
    await adjustItineraryTool(reqWith({
      call: { call_id: 'call_1' }, args: { add_nights: 1, hotel_name: 12345, trip_confirmed: true },
    }), res(), next);
    expect(mockAdjustItinerary).toHaveBeenCalledWith('lead-1', { addNights: 1 }, 'req-1');
  });
});

describe('preview_price — the figure is never returned to the agent', () => {
  it('does not include any financial figure in the tool response', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockPreviewPricing.mockResolvedValue({ financials: { totalAmount: 2400, balanceDue: 1680 }, persisted: false });
    const r = res();
    await previewPriceTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(JSON.stringify(r.json.mock.calls[0][0])).not.toMatch(/2400|1680/);
  });

  it('still calls previewPricing so the draft has fresh numbers for a rep', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockPreviewPricing.mockResolvedValue({ financials: {}, persisted: false });
    await previewPriceTool(reqWith({ call: { call_id: 'call_1' } }), res(), next);
    expect(mockPreviewPricing).toHaveBeenCalledWith('lead-1', 'req-1');
  });
});

describe('resend_document — only ever re-sends what already exists', () => {
  it('reports no_active_lead when the call has no bound lead', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: null, disposition: 'IN_PROGRESS' });
    const r = res();
    await resendDocumentTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ sent: false, reason: 'no_active_lead' });
    expect(mockGetLatestSentDocument).not.toHaveBeenCalled();
  });

  it('reports nothing_sent_yet when the lead has never had anything sent', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetLatestSentDocument.mockResolvedValue({ latest: null });
    const r = res();
    await resendDocumentTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ sent: false, reason: 'nothing_sent_yet' });
    expect(mockResendDocument).not.toHaveBeenCalled();
  });

  it('resends using the document found on the lead, never an id from args', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetLatestSentDocument.mockResolvedValue({ latest: { type: 'quotation', id: 'quote-real' } });
    mockResendDocument.mockResolvedValue({ email: 'sent', whatsapp: 'sent' });
    await resendDocumentTool(reqWith({
      call: { call_id: 'call_1' }, args: { document_id: 'attacker-supplied-id' },
    }), res(), next);
    expect(mockResendDocument).toHaveBeenCalledWith('quotation', 'quote-real', 'req-1');
  });

  it('resends whichever type was most recently sent, e.g. an invoice', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetLatestSentDocument.mockResolvedValue({ latest: { type: 'invoice', id: 'inv-1' } });
    mockResendDocument.mockResolvedValue({ email: 'sent', whatsapp: null });
    const r = res();
    await resendDocumentTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(mockResendDocument).toHaveBeenCalledWith('invoice', 'inv-1', 'req-1');
    expect(r.json.mock.calls[0][0].documentType).toBe('invoice');
  });

  it('reports sent:true when at least one channel succeeds', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetLatestSentDocument.mockResolvedValue({ latest: { type: 'quotation', id: 'quote-1' } });
    mockResendDocument.mockResolvedValue({ email: 'sent', whatsapp: 'failed' });
    const r = res();
    await resendDocumentTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ sent: true, documentType: 'quotation', email: 'sent', whatsapp: 'failed' });
  });

  it('reports sent:false when every channel fails', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetLatestSentDocument.mockResolvedValue({ latest: { type: 'quotation', id: 'quote-1' } });
    mockResendDocument.mockResolvedValue({ email: 'failed', whatsapp: 'failed' });
    const r = res();
    await resendDocumentTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ sent: false, documentType: 'quotation', email: 'failed', whatsapp: 'failed' });
  });
});

describe('audit trail', () => {
  it('logs a VoiceCallEvent for a successful call', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), res(), next);
    expect(mockVoiceCallEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ voiceCallId: 'vc-1', functionName: 'get_trip_status', succeeded: true }),
    }));
  });

  it('logs a failed call as succeeded:false rather than crashing the webhook', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetTripBrief.mockRejectedValue(new Error('lead-service down'));
    const r = res();
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ error: true, message: 'Could not complete that right now.' });
    expect(mockVoiceCallEventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ succeeded: false }),
    }));
  });

  it('does not log an event when no call id was present to attribute it to', async () => {
    await searchPackagesTool(reqWith({ args: { query: 'maldives' } }), res(), next);
    expect(mockVoiceCallEventCreate).not.toHaveBeenCalled();
  });

  // Regression: `sequence` is a 32-bit Postgres Int. An earlier version
  // derived it from Date.now(), which overflows Int32 by roughly a
  // thousandfold — every insert failed, silently, because the write was
  // wrapped in a bare .catch(() => {}). Verified live against the real
  // database before this fix (zero events ever landed); this pins the fix
  // so it can't regress back to a Date.now()-derived value.
  it('numbers the first event on a call as sequence 0, not a timestamp', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockVoiceCallEventCount.mockResolvedValue(0);
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), res(), next);
    const sequence = mockVoiceCallEventCreate.mock.calls[0][0].data.sequence;
    expect(sequence).toBe(0);
    expect(sequence).toBeLessThan(2 ** 31);
  });

  it('numbers a second event on the same call as sequence 1', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockVoiceCallEventCount.mockResolvedValue(1);
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), res(), next);
    expect(mockVoiceCallEventCreate.mock.calls[0][0].data.sequence).toBe(1);
  });

  it('logs loudly, via the structured logger, when the audit write itself fails', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    mockVoiceCallEventCreate.mockRejectedValue(new Error('P2002 unique violation'));
    const log = { error: vi.fn() };
    await getTripStatusTool({ ...reqWith({ call: { call_id: 'call_1' } }), log }, res(), next);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'call_1', functionName: 'get_trip_status' }),
      'Failed to log VoiceCallEvent'
    );
  });
});

describe('only the call in progress may act', () => {
  it('refuses get_trip_status for a completed call, without ever calling the downstream client', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'COMPLETED' });
    const r = res();
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ available: false });
    expect(mockGetTripBrief).not.toHaveBeenCalled();
  });

  it('does not use a tool argument as a conversation id without the provider header', async () => {
    const r = res();
    await getTripStatusTool(reqWith({ args: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ available: false });
    expect(mockVoiceCallFindUnique).not.toHaveBeenCalled();
    expect(mockGetTripBrief).not.toHaveBeenCalled();
  });

  it('coerces a numeric-string add_nights but never invents one from an empty or null add_nights', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockAdjustItinerary.mockResolvedValue({ nights: 5 });

    await adjustItineraryTool(reqWith({
      call: { call_id: 'call_1' }, args: { add_nights: '2', trip_confirmed: true },
    }), res(), next);
    expect(mockAdjustItinerary).toHaveBeenCalledWith('lead-1', { addNights: 2 }, 'req-1');

    // Number('') and Number(null) are both 0 — accepting either would invent an
    // "add zero nights" change nobody asked for.
    for (const addNights of ['', null]) {
      const r = res();
      await adjustItineraryTool(reqWith({
        call: { call_id: 'call_1' }, args: { add_nights: addNights, trip_confirmed: true },
      }), r, next);
      expect(r.json.mock.calls[0][0]).toEqual({ adjusted: false, reason: 'no_changes_given' });
    }
    expect(mockAdjustItinerary).toHaveBeenCalledTimes(1);
  });
});

describe('audit-write failures are never fatal', () => {
  it('answers with the handler result even when the audit insert rejects', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    mockVoiceCallEventCreate.mockRejectedValueOnce(new Error('audit table down'));
    const r = res();
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ available: true, statusClass: 'quote_sent' });
  });

  it('retries a P2002 rejection exactly once with a freshly-read count', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    mockVoiceCallEventCount.mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    mockVoiceCallEventCreate
      .mockRejectedValueOnce(Object.assign(new Error('unique violation'), { code: 'P2002' }))
      .mockResolvedValueOnce({});
    const r = res();
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(mockVoiceCallEventCreate).toHaveBeenCalledTimes(2);
    expect(mockVoiceCallEventCount).toHaveBeenCalledTimes(2);
    expect(mockVoiceCallEventCreate.mock.calls[1][0].data.sequence).toBe(4);
    expect(r.json.mock.calls[0][0]).toEqual({ available: true, statusClass: 'quote_sent' });
  });

  it('does not retry a non-P2002 audit rejection', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: 'lead-1', disposition: 'IN_PROGRESS' });
    mockGetTripBrief.mockResolvedValue({ statusClass: 'quote_sent' });
    mockVoiceCallEventCreate.mockRejectedValueOnce(new Error('connection reset'));
    await getTripStatusTool(reqWith({ call: { call_id: 'call_1' } }), res(), next);
    expect(mockVoiceCallEventCreate).toHaveBeenCalledTimes(1);
  });
});

describe('lead-bound tools degrade honestly when there is no active lead', () => {
  it('attach_package reports no_active_lead rather than an error', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: null, disposition: 'IN_PROGRESS' });
    const r = res();
    await attachPackageTool(reqWith({
      call: { call_id: 'call_1' }, args: { package_id: 'pkg-1', trip_confirmed: true },
    }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ attached: false, reason: 'no_active_lead' });
    expect(mockAttachPackage).not.toHaveBeenCalled();
  });

  it('adjust_itinerary reports no_active_lead rather than an error', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: null, disposition: 'IN_PROGRESS' });
    const r = res();
    await adjustItineraryTool(reqWith({
      call: { call_id: 'call_1' }, args: { add_nights: 2, trip_confirmed: true },
    }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ adjusted: false, reason: 'no_active_lead' });
    expect(mockAdjustItinerary).not.toHaveBeenCalled();
  });

  it('get_payment_status reports unavailable rather than an error', async () => {
    mockVoiceCallFindUnique.mockResolvedValue({ id: 'vc-1', leadId: null, disposition: 'IN_PROGRESS' });
    const r = res();
    await getPaymentStatusTool(reqWith({ call: { call_id: 'call_1' } }), r, next);
    expect(r.json.mock.calls[0][0]).toEqual({ available: false });
    expect(mockGetPaymentBrief).not.toHaveBeenCalled();
  });
});
