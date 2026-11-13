import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/appError.js';
import {
  EMAIL_NOT_CONFIGURED,
  EMAIL_SEND_FAILED,
  WHATSAPP_UNAVAILABLE,
  INVALID_EMAIL_PAYLOAD,
  INVALID_WHATSAPP_PAYLOAD,
} from '../constants/errorMessages.js';
import { sendEmailSchema } from '../validators/email.validator.js';
import { sendWhatsappSchema } from '../validators/whatsapp.validator.js';
import { sendEmail as deliverEmail } from '../utils/email.js';
import { sendWhatsappTemplateMessage, sendWhatsappTextMessage } from '../utils/whatsapp.js';

const maskEmail = (addr) => addr.replace(/^[^@]+/, '***');
const maskRecipients = (to) => (Array.isArray(to) ? to.map(maskEmail) : maskEmail(to));
const maskPhone = (phone) => String(phone || '').replace(/\d(?=\d{2})/g, '*');

export const getNotifications = asyncHandler(async (req, res) => {
  res.json({ success: true, data: [], message: 'In-app notifications coming soon' });
});

export const markAsRead = asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'Marked as read' });
});

export const sendEmail = asyncHandler(async (req, res) => {
  const parsed = sendEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw new AppError(INVALID_EMAIL_PAYLOAD, 400, { code: 'VALIDATION_FAILED', errors });
  }

  const { to, subject, html, text, replyTo, attachments, meta } = parsed.data;

  try {
    const result = await deliverEmail({ to, subject, html, text, replyTo, attachments });
    req.log.info({ to: maskRecipients(to), subject, meta }, 'Email sent');
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    req.log.error({ err, to: maskRecipients(to), subject, meta }, 'Failed to send email');
    // A delivery fault already written for the caller (attachment size, transport
    // unavailable) is passed through; anything else is reported generically by the
    // central error handler rather than echoing a raw transport message.
    if (err.isOperational) throw err;
    // An unconfigured transport reports 503 without being operational; keep the
    // status class so a caller can tell an outage from a rejected send.
    if (err.statusCode === 503) {
      throw new AppError(EMAIL_NOT_CONFIGURED, 503, { code: 'DEPENDENCY_UNAVAILABLE' });
    }
    throw new AppError(EMAIL_SEND_FAILED, 502, { code: 'DEPENDENCY_UNAVAILABLE' });
  }
});

export const sendWhatsapp = asyncHandler(async (req, res) => {
  const parsed = sendWhatsappSchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw new AppError(INVALID_WHATSAPP_PAYLOAD, 400, { code: 'VALIDATION_FAILED', errors });
  }

  const { to, meta, ...rest } = parsed.data;

  try {
    const result =
      rest.type === 'template'
        ? await sendWhatsappTemplateMessage({ to, ...rest })
        : await sendWhatsappTextMessage({ to, ...rest });
    req.log.info({ to: maskPhone(to), type: rest.type, meta }, 'WhatsApp message sent');
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    req.log.error({ err, to: maskPhone(to), type: rest.type, meta }, 'Failed to send WhatsApp message');
    if (err.isOperational) throw err;
    if (err.statusCode === 503) {
      throw new AppError(WHATSAPP_UNAVAILABLE, 503, { code: 'DEPENDENCY_UNAVAILABLE' });
    }
    throw new AppError(WHATSAPP_UNAVAILABLE, 502, { code: 'DEPENDENCY_UNAVAILABLE' });
  }
});
