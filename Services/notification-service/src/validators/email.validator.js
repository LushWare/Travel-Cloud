import { z } from 'zod';

const attachmentSchema = z.object({
  filename: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  contentBase64: z.string().min(1),
});

export const sendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().trim().min(1).max(300),
  html: z.string().min(1),
  text: z.string().optional(),
  replyTo: z.string().trim().email().optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  meta: z
    .object({
      sourceService: z.string().trim().min(1),
      kind: z.string().trim().min(1),
    })
    .partial()
    .optional(),
});
