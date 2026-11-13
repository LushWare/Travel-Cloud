import { z } from 'zod';

const attachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1).max(13_981_016),
});

export const sendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1).max(50)]),
  subject: z.string().trim().min(1).max(300),
  html: z.string().min(1).max(2_000_000),
  text: z.string().max(2_000_000).optional(),
  replyTo: z.string().trim().email().optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
});
