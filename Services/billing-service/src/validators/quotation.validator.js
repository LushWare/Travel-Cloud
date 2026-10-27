import { z } from 'zod';

/**
 * Body for POST /quotations/:id/send. `channel` picks the delivery medium;
 * `email`/`phone` optionally override the customer snapshot's contact.
 */
export const sendQuotationSchema = z
  .object({
    channel: z.enum(['email', 'whatsapp']).default('email'),
    email: z.string().email().optional(),
    phone: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.channel !== 'whatsapp' || true, { message: 'Invalid send payload' });

export const voiceAutoSendQuotationSchema = z.object({
  leadId: z.string().min(1),
  packageId: z.string().min(1),
  expectedPackagePrice: z.number().finite().nonnegative(),
}).strict();

/**
 * Body for POST /quotations/:id/convert. Every field is an optional
 * per-invoice override — anything omitted falls back to the source
 * quotation's snapshot (customer/destination) or current org settings
 * (bank/terms), never to the client silently recomputing pricing: pricing
 * fields are deliberately NOT accepted here, they're always copied verbatim
 * from the quotation.
 */
export const convertToInvoiceSchema = z
  .object({
    dueDate: z.coerce.date().optional(),
    bookingId: z.string().trim().min(1).nullable().optional(),

    customerName: z.string().trim().min(1).optional(),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().trim().min(1).nullable().optional(),
    customerAddress: z.string().trim().min(1).nullable().optional(),
    customerGstNumber: z.string().trim().min(1).nullable().optional(),
    destination: z.string().trim().min(1).nullable().optional(),

    notes: z.string().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    paymentInstructions: z.string().nullable().optional(),

    bankAccountName: z.string().trim().min(1).nullable().optional(),
    bankAccountNumber: z.string().trim().min(1).nullable().optional(),
    bankName: z.string().trim().min(1).nullable().optional(),
    bankIfscCode: z.string().trim().min(1).nullable().optional(),
    bankSwiftCode: z.string().trim().min(1).nullable().optional(),
    bankBranch: z.string().trim().min(1).nullable().optional(),
    bankUpiId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();
