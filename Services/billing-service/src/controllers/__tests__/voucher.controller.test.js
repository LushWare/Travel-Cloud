import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVoucherFindUnique, mockVoucherUpdate, mockVoucherCreate, mockVoucherDelete,
  mockLocationDateDeleteMany, mockMealPlanDeleteMany, mockItinerarySummaryDeleteMany, mockFlightSegmentDeleteMany,
  mockGeneratePDF, mockSendEmail, mockSendWhatsapp, mockUpload, mockLogLeadCommunication,
} = vi.hoisted(() => ({
  mockVoucherFindUnique: vi.fn(),
  mockVoucherUpdate: vi.fn(),
  mockVoucherCreate: vi.fn(),
  mockVoucherDelete: vi.fn(),
  mockLocationDateDeleteMany: vi.fn(),
  mockMealPlanDeleteMany: vi.fn(),
  mockItinerarySummaryDeleteMany: vi.fn(),
  mockFlightSegmentDeleteMany: vi.fn(),
  mockGeneratePDF: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendWhatsapp: vi.fn(),
  mockUpload: vi.fn(),
  mockLogLeadCommunication: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  default: {
    voucher: {
      findUnique: mockVoucherFindUnique, update: mockVoucherUpdate, create: mockVoucherCreate, delete: mockVoucherDelete,
    },
    voucherLocationDate: { deleteMany: mockLocationDateDeleteMany },
    voucherMealPlan: { deleteMany: mockMealPlanDeleteMany },
    voucherItinerarySummary: { deleteMany: mockItinerarySummaryDeleteMany },
    voucherFlightSegment: { deleteMany: mockFlightSegmentDeleteMany },
  },
}));
vi.mock('../../utils/voucherPDFGenerator.js', () => ({ generateVoucherPDF: mockGeneratePDF }));
vi.mock('../../utils/emailService.js', () => ({ sendVoucherEmail: mockSendEmail }));
vi.mock('../../utils/whatsappService.js', () => ({ sendVoucherWhatsapp: mockSendWhatsapp }));
vi.mock('../../utils/cloudinary.js', () => ({ uploadPdfBuffer: mockUpload }));
vi.mock('../../utils/docNumber.js', () => ({
  nextVoucherNumber: vi.fn().mockResolvedValue('VOU-202608-00001'),
}));
vi.mock('../../services/events.client.js', () => ({ logLeadCommunication: mockLogLeadCommunication }));

import {
  createVoucher, updateVoucher, sendVoucher, downloadVoucherPDF,
} from '../voucher.controller.js';
import AppError from '../../utils/appError.js';

const voucher = {
  id: 'vch-1',
  voucherNumber: 'VOU-202608-00001',
  status: 'draft',
  leadId: 'lead-1',
  customerName: 'Alice',
  customerEmail: 'alice@test.com',
  customerPhone: '+15551234567',
  travelStartDate: new Date('2026-05-10'),
  travelEndDate: new Date('2026-05-15'),
  locationDates: [],
  mealPlans: [],
  itinerarySummary: [],
  flightSegments: [],
};

function mockRes() {
  return { json: vi.fn(), setHeader: vi.fn(), send: vi.fn(), status: vi.fn().mockReturnThis() };
}

async function run(handler, req) {
  const res = mockRes();
  let nextErr;
  const fullReq = { user: { id: 'user-1' }, log: { error: vi.fn() }, ...req };
  await handler(fullReq, res, (err) => { nextErr = err; });
  return { res, nextErr };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVoucherFindUnique.mockResolvedValue({ ...voucher });
  mockVoucherUpdate.mockImplementation(async ({ data }) => ({ ...voucher, ...data }));
  mockVoucherCreate.mockImplementation(async ({ data }) => ({ id: 'vch-1', ...data }));
  mockGeneratePDF.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockSendEmail.mockResolvedValue({ messageId: 'm-1' });
  mockSendWhatsapp.mockResolvedValue({ sid: 'SM1' });
  mockUpload.mockResolvedValue('https://cdn.example.com/vouchers/vch.pdf');
  mockLogLeadCommunication.mockResolvedValue({ matched: true });
});

describe('createVoucher', () => {
  it('persists flight segments alongside location dates, meal plans, and itinerary summary', async () => {
    await run(createVoucher, {
      body: {
        leadId: 'lead-1',
        customerName: 'Alice',
        customerEmail: 'alice@test.com',
        locationDates: [{ location: 'Male', hotelName: 'Coco Bodu Hithi' }],
        mealPlans: [{ dayNumber: 1, breakfast: true, lunch: true, dinner: true }],
        itinerarySummary: [{ dayNumber: 1, title: 'Arrival' }],
        flightSegments: [{ dayNumber: 1, marketingCarrier: 'UL', flightNumber: 'UL103', origin: 'CMB', destination: 'MLE' }],
      },
    });

    expect(mockVoucherCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        flightSegments: { create: [{ dayNumber: 1, marketingCarrier: 'UL', flightNumber: 'UL103', origin: 'CMB', destination: 'MLE', order: 0 }] },
      }),
    }));
  });

  it('creates an empty flightSegments relation when none are supplied', async () => {
    await run(createVoucher, { body: { leadId: 'lead-1', customerName: 'Alice', customerEmail: 'alice@test.com' } });
    expect(mockVoucherCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ flightSegments: { create: [] } }),
    }));
  });
});

describe('createVoucher validation', () => {
  it('rejects a payload missing leadId', async () => {
    const { nextErr } = await run(createVoucher, { body: { customerName: 'Alice', customerEmail: 'alice@test.com' } });
    expect(nextErr).toBeDefined();
    expect(mockVoucherCreate).not.toHaveBeenCalled();
  });

  it('rejects an invalid customerEmail', async () => {
    const { nextErr } = await run(createVoucher, {
      body: { leadId: 'lead-1', customerName: 'Alice', customerEmail: 'not-an-email' },
    });
    expect(nextErr).toBeDefined();
    expect(mockVoucherCreate).not.toHaveBeenCalled();
  });

  it('strips unknown top-level fields instead of forwarding them to Prisma', async () => {
    await run(createVoucher, {
      body: {
        leadId: 'lead-1',
        customerName: 'Alice',
        customerEmail: 'alice@test.com',
        customer: { name: 'Alice' },
      },
    });
    expect(mockVoucherCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ customer: expect.anything() }),
    }));
  });
});

describe('updateVoucher', () => {
  it('replaces flight segments (delete then recreate) when the field is present', async () => {
    await run(updateVoucher, {
      params: { id: 'vch-1' },
      body: { flightSegments: [{ dayNumber: 2, marketingCarrier: 'UL', flightNumber: 'UL104' }] },
    });

    expect(mockFlightSegmentDeleteMany).toHaveBeenCalledWith({ where: { voucherId: 'vch-1' } });
    expect(mockVoucherUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        flightSegments: { create: [{ dayNumber: 2, marketingCarrier: 'UL', flightNumber: 'UL104', order: 0 }] },
      }),
    }));
  });

  it('leaves existing flight segments untouched when the field is omitted', async () => {
    await run(updateVoucher, { params: { id: 'vch-1' }, body: { notes: 'updated notes' } });
    expect(mockFlightSegmentDeleteMany).not.toHaveBeenCalled();
    expect(mockVoucherUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ flightSegments: expect.anything() }),
    }));
  });

  it('404s when the voucher does not exist', async () => {
    mockVoucherFindUnique.mockResolvedValue(null);
    const { nextErr } = await run(updateVoucher, { params: { id: 'missing' }, body: {} });
    expect(nextErr.statusCode).toBe(404);
  });
});

describe('updateVoucher validation', () => {
  it('rejects an invalid status value', async () => {
    const { nextErr } = await run(updateVoucher, { params: { id: 'vch-1' }, body: { status: 'archived' } });
    expect(nextErr).toBeDefined();
    expect(mockVoucherUpdate).not.toHaveBeenCalled();
  });

  it('does not default an omitted flightSegments field to [] and wipe the relation', async () => {
    await run(updateVoucher, { params: { id: 'vch-1' }, body: { notes: 'updated' } });
    expect(mockFlightSegmentDeleteMany).not.toHaveBeenCalled();
  });
});

describe('downloadVoucherPDF', () => {
  it('streams the generated PDF with the correct headers', async () => {
    const { res, nextErr } = await run(downloadVoucherPDF, { params: { id: 'vch-1' } });

    expect(nextErr).toBeUndefined();
    expect(mockGeneratePDF).toHaveBeenCalledWith(voucher);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('voucher-VOU-202608-00001.pdf'));
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it('404s when the voucher does not exist', async () => {
    mockVoucherFindUnique.mockResolvedValue(null);
    const { nextErr } = await run(downloadVoucherPDF, { params: { id: 'missing' } });
    expect(nextErr.statusCode).toBe(404);
    expect(mockGeneratePDF).not.toHaveBeenCalled();
  });

  it('propagates a 422 with a descriptive message when org settings are incomplete', async () => {
    mockGeneratePDF.mockRejectedValue(new AppError('Cannot generate voucher: organization settings are incomplete (missing: companyAddress).', 422));
    const { nextErr } = await run(downloadVoucherPDF, { params: { id: 'vch-1' } });
    expect(nextErr.statusCode).toBe(422);
    expect(nextErr.message).toMatch(/organization settings are incomplete/i);
  });
});

describe('sendVoucher', () => {
  it('emails the voucher with the generated PDF and flips status from draft to sent', async () => {
    const { res, nextErr } = await run(sendVoucher, { params: { id: 'vch-1' }, body: { channel: 'email' } });

    expect(nextErr).toBeUndefined();
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      recipientEmail: 'alice@test.com',
      pdfBuffer: expect.any(Buffer),
    }));
    expect(mockVoucherUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'sent', emailSent: true }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('does not re-flip status away from confirmed on a resend', async () => {
    mockVoucherFindUnique.mockResolvedValue({ ...voucher, status: 'confirmed' });
    await run(sendVoucher, { params: { id: 'vch-1' }, body: { channel: 'email' } });
    expect(mockVoucherUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ status: expect.anything() }),
    }));
  });

  it('uses the body email override instead of the customer snapshot', async () => {
    await run(sendVoucher, { params: { id: 'vch-1' }, body: { channel: 'email', email: 'override@test.com' } });
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ recipientEmail: 'override@test.com' }));
  });

  it('uploads the PDF and sends over WhatsApp with the media URL', async () => {
    const { res } = await run(sendVoucher, { params: { id: 'vch-1' }, body: { channel: 'whatsapp' } });

    expect(mockUpload).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mockSendWhatsapp).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15551234567',
      mediaUrl: 'https://cdn.example.com/vouchers/vch.pdf',
    }));
    expect(mockVoucherUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ whatsappSent: true, whatsappSentAt: expect.any(Date), pdfUrl: 'https://cdn.example.com/vouchers/vch.pdf' }),
    }));
    expect(res.json).toHaveBeenCalled();
  });

  it('returns a 400 (not a crash) when the channel is not configured', async () => {
    mockSendEmail.mockRejectedValue(new Error('Email is not configured (set EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD)'));

    const { nextErr } = await run(sendVoucher, { params: { id: 'vch-1' }, body: { channel: 'email' } });

    expect(nextErr).toBeDefined();
    expect(nextErr.statusCode).toBe(400);
    // The transport names EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD; none of that may
    // reach the caller.
    expect(nextErr.message).toBe("We couldn't send that voucher. Please try again.");
    expect(nextErr.message).not.toMatch(/EMAIL_HOST|EMAIL_USER|EMAIL_PASSWORD|not configured/i);
    expect(mockVoucherUpdate).not.toHaveBeenCalled();
  });

  it('404s when the voucher does not exist', async () => {
    mockVoucherFindUnique.mockResolvedValue(null);
    const { nextErr } = await run(sendVoucher, { params: { id: 'missing' }, body: { channel: 'email' } });
    expect(nextErr.statusCode).toBe(404);
  });

  it('rejects an invalid channel via the Zod schema', async () => {
    const { nextErr } = await run(sendVoucher, { params: { id: 'vch-1' }, body: { channel: 'carrier-pigeon' } });
    expect(nextErr).toBeDefined();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('400s on a WhatsApp send when no phone is available anywhere', async () => {
    mockVoucherFindUnique.mockResolvedValue({ ...voucher, customerPhone: null });
    const { nextErr } = await run(sendVoucher, { params: { id: 'vch-1' }, body: { channel: 'whatsapp' } });
    expect(nextErr.statusCode).toBe(400);
    expect(mockSendWhatsapp).not.toHaveBeenCalled();
  });

  it('400s on an email send when no email is available anywhere', async () => {
    mockVoucherFindUnique.mockResolvedValue({ ...voucher, customerEmail: null });
    const { nextErr } = await run(sendVoucher, { params: { id: 'vch-1' }, body: { channel: 'email' } });
    expect(nextErr.statusCode).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
