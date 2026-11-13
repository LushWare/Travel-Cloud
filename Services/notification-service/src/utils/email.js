import nodemailer from 'nodemailer';
import AppError from './appError.js';
import { EMAIL_NOT_CONFIGURED } from '../constants/errorMessages.js';
import { sendWithAgencyEmail } from '../services/integration.client.js';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Nodemailer transport built from env. Returns null when SMTP is not configured. */
function buildTransport() {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASSWORD } = process.env;
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASSWORD) return null;
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: parseInt(EMAIL_PORT, 10) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
  });
}

export const isEmailConfigured = () => buildTransport() !== null;

/**
 * Decode and size-check base64 attachments before handing them to nodemailer,
 * so a bad/oversized payload from a caller can't be used to exhaust memory here.
 */
function decodeAttachments(attachments = []) {
  return attachments.map(({ filename, contentType, contentBase64 }) => {
    const content = Buffer.from(contentBase64, 'base64');
    if (content.byteLength > MAX_ATTACHMENT_BYTES) {
      // Written for the caller and safe to show: it names the file the caller sent.
      throw new AppError(
        `Attachment "${filename}" exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`,
        400,
        { code: 'BAD_REQUEST' },
      );
    }
    return { filename, contentType, content };
  });
}

export async function sendEmail({ to, subject, html, text, replyTo, attachments }) {
  const agencyResult = await sendWithAgencyEmail({ to, subject, html, text, replyTo, attachments });
  if (agencyResult) return agencyResult;

  const transporter = buildTransport();
  if (!transporter) {
    throw new AppError(EMAIL_NOT_CONFIGURED, 503, { code: 'DEPENDENCY_UNAVAILABLE' });
  }

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    ...(replyTo && { replyTo }),
    subject,
    html,
    text,
    attachments: decodeAttachments(attachments),
  });
  return { messageId: info.messageId };
}
