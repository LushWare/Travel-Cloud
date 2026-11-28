import { z } from 'zod';
import { moneyField } from './money.js';
import { ItineraryDay } from './itineraryDay.js';

// The POST body lead-service sends to billing-service's
// POST /api/v1/billing/quotations/from-lead handoff. Mirrors exactly the
// object literal built in snapshotSelectionQuotation
// (Services/lead-service/src/services/lead-selection.service.js) — fields
// that are always present-but-null today are .nullable(), not .optional(),
// so parsing the real payload as-is succeeds unchanged.
export const LeadSnapshotForQuotation = z.object({
  leadId: z.string().min(1),
  packageId: z.string().min(1).nullable(),
  // billing has no request user on this internal (gateway-bypassing) call.
  createdById: z.string().min(1).nullable(),
  currency: z.string().min(1),
  customer: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }),
  items: z.array(
    z.object({
      description: z.string(),
      category: z.string(),
      quantity: z.number(),
      unitPrice: moneyField,
      notes: z.string().nullable(),
    }),
  ),
  discountType: z.string(),
  discountValue: moneyField,
  serviceChargeRate: moneyField,
  // The tax % the lead was priced at. Omitted = billing uses the Settings default.
  taxRate: moneyField.optional(),
  notes: z.string().nullable(),
  terms: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  includedServices: z.array(z.string()),
  excludedServices: z.array(z.string()),
  destination: z.string().nullable(),
  packageTitle: z.string().nullable(),
  travelStartDate: z.coerce.date().nullable(),
  travelEndDate: z.coerce.date().nullable(),
  paxCount: z.number().int().nullable(),
  durationNights: z.number().int().nullable(),
  durationDays: z.number().int().nullable(),
  highlights: z.array(z.string()),
  itineraryDays: z.array(ItineraryDay),
  coverImage: z.string().nullable(),
});
