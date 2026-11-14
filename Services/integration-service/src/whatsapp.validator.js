import { z } from 'zod';

const headerDocumentSchema = z.object({
  link: z.string().url(),
  filename: z.string().trim().min(1).max(255),
});

export const sendWhatsappSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('template'),
    to: z.string().trim().min(1).max(32),
    templateName: z.string().trim().min(1).max(512),
    languageCode: z.string().trim().min(1).max(32).default('en_US'),
    headerDocument: headerDocumentSchema.optional(),
    bodyParams: z.array(z.string().max(1024)).max(10).optional(),
  }).strict(),
  z.object({
    type: z.literal('text'),
    to: z.string().trim().min(1).max(32),
    body: z.string().trim().min(1).max(4096),
  }).strict(),
]);