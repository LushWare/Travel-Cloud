import dns from 'node:dns/promises';
import net from 'node:net';
import nodemailer from 'nodemailer';
import { z } from 'zod';

export const smtpSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.coerce.number().int().refine((value) => [465, 587, 2525].includes(value), 'Unsupported SMTP port'),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024),
  from: z.string().trim().email(),
  replyTo: z.string().trim().email().optional(),
}).superRefine((config, context) => {
  if (config.secure !== (config.port === 465)) {
    context.addIssue({ code: 'custom', path: ['secure'], message: 'Port 465 requires TLS; other supported ports use STARTTLS.' });
  }
});

function isPublicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    const first = parseInt(normalized.split(':')[0] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff &&
      !normalized.startsWith('2001:db8:') &&
      !normalized.startsWith('2002:') &&
      !/^2001:(?:0|0000):/.test(normalized);
  }
  return false;
}

export async function resolveSmtpHost(host) {
  if (net.isIP(host) || host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('SMTP host is not allowed');
  }
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('SMTP host is not allowed');
  }
  return records[0].address;
}

export async function verifySmtp(config) {
  const address = await resolveSmtpHost(config.host);
  const transporter = nodemailer.createTransport({
    host: address,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.username, pass: config.password },
    tls: { servername: config.host, rejectUnauthorized: true },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  try {
    await transporter.verify();
  } finally {
    transporter.close();
  }
}

export async function sendSmtp(config, message) {
  const address = await resolveSmtpHost(config.host);
  const transporter = nodemailer.createTransport({
    host: address,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.username, pass: config.password },
    tls: { servername: config.host, rejectUnauthorized: true },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  try {
    const attachments = (message.attachments || []).map(({ filename, contentType, contentBase64 }) => {
      const content = Buffer.from(contentBase64, 'base64');
      if (content.byteLength > 10 * 1024 * 1024) throw new Error('Email attachment exceeds the allowed size');
      return { filename, contentType, content };
    });
    const info = await transporter.sendMail({
      from: config.from,
      ...((message.replyTo || config.replyTo) ? { replyTo: message.replyTo || config.replyTo } : {}),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments,
    });
    return { messageId: info.messageId };
  } finally {
    transporter.close();
  }
}
