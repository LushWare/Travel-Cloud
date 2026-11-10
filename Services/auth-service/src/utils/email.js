import logger from '../config/logger.js';
import { sendEmail as sendViaNotificationService } from '../services/email.client.js';
import { renderEmailLayout, renderButton, escapeHtml } from './emailLayout.js';

const FOOTER_TEXT = '\n\n— LushTravel CRM (this is an automated message, please do not reply)';

const send = ({ to, subject, html, text }) =>
  sendViaNotificationService({ to, subject, html, text, meta: { sourceService: 'auth-service', kind: subject } });

export const sendWelcomeEmail = (user) => {
  const html = renderEmailLayout({
    title: 'Welcome to LushTravel',
    preheader: `Your LushTravel account is ready, ${user.name}.`,
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;">Welcome aboard, ${escapeHtml(user.name)}!</h2>
      <p style="margin:0 0 16px;">Your LushTravel account has been created successfully. You're all set to start planning your next trip.</p>
      <p style="margin:0;">If you have any questions, our team is happy to help.</p>`,
  });
  const text = `Welcome aboard, ${user.name}!\n\nYour LushTravel account has been created successfully. You're all set to start planning your next trip.\n\nIf you have any questions, our team is happy to help.${FOOTER_TEXT}`;

  return send({ to: user.email, subject: 'Welcome to LushTravel!', html, text })
    .catch((err) => logger.error({ err, email: user.email }, 'Failed to send welcome email'));
};

export const sendEmailVerification = (user, token) => {
  const url = `${process.env.CLIENT_URL || 'http://localhost:5173'}/verify-email/${token}`;
  const html = renderEmailLayout({
    title: 'Verify your email address',
    preheader: 'Confirm your email to activate your LushTravel account.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;">Verify your email</h2>
      <p style="margin:0 0 8px;">Hi ${escapeHtml(user.name)}, confirm this is your email address to activate your account.</p>
      ${renderButton({ href: url, label: 'Verify Email Address' })}
      <p style="margin:16px 0 0;color:#64748B;font-size:13px;">Or paste this link into your browser:<br/><a href="${url}" style="color:#0578A2;">${url}</a></p>
      <p style="margin:12px 0 0;color:#64748B;font-size:13px;">This link expires in 24 hours. If you didn't create a LushTravel account, you can ignore this email.</p>`,
  });
  const text = `Hi ${user.name}, confirm your email address:\n${url}\n\nThis link expires in 24 hours. If you didn't create a LushTravel account, you can ignore this email.${FOOTER_TEXT}`;

  return send({ to: user.email, subject: 'Verify your email address', html, text })
    .catch((err) => logger.error({ err, email: user.email }, 'Failed to send email verification'));
};

export const sendPasswordReset = (user, token) => {
  const url = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password/${token}`;
  const html = renderEmailLayout({
    title: 'Password Reset Request',
    preheader: 'Reset your LushTravel account password.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;">Reset your password</h2>
      <p style="margin:0 0 8px;">Hi ${escapeHtml(user.name)}, you requested a password reset. Click below to choose a new password:</p>
      ${renderButton({ href: url, label: 'Reset Password' })}
      <p style="margin:16px 0 0;color:#64748B;font-size:13px;">Or paste this link into your browser:<br/><a href="${url}" style="color:#0578A2;">${url}</a></p>
      <p style="margin:12px 0 0;color:#64748B;font-size:13px;">This link expires in 1 hour. If you didn't request this, ignore this email and your password will remain unchanged.</p>`,
  });
  const text = `Hi ${user.name}, you requested a password reset:\n${url}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email and your password will remain unchanged.${FOOTER_TEXT}`;

  // No .catch() here: password-reset delivery failure is blocking — callers
  // await this and must see the rejection to surface a real error response.
  return send({ to: user.email, subject: 'Password Reset Request', html, text });
};

/** Staff invite or admin-requested reset: a one-time link to choose a password in Management. */
export const sendSetPasswordLink = (user, token, { invite, hours }) => {
  const url = `${process.env.MANAGEMENT_URL || 'http://localhost:5174'}/set-password/${token}`;
  const heading = invite ? "You've been invited" : 'Set a new password';
  const intro = invite
    ? `Hi ${escapeHtml(user.name)}, an account has been created for you. Click below to choose your password and sign in:`
    : `Hi ${escapeHtml(user.name)}, an administrator asked for your password to be reset. Click below to choose a new one:`;
  const html = renderEmailLayout({
    title: heading,
    preheader: invite ? 'Set your password to start using LushTravel.' : 'Choose a new LushTravel password.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;">${heading}</h2>
      <p style="margin:0 0 8px;">${intro}</p>
      ${renderButton({ href: url, label: 'Set Password' })}
      <p style="margin:16px 0 0;color:#64748B;font-size:13px;">Or paste this link into your browser:<br/><a href="${url}" style="color:#0578A2;">${url}</a></p>
      <p style="margin:12px 0 0;color:#64748B;font-size:13px;">This link works once and expires in ${hours} hours.</p>`,
  });
  const text = `${heading}\n\n${intro.replace(/<[^>]+>/g, '')}\n${url}\n\nThis link works once and expires in ${hours} hours.${FOOTER_TEXT}`;

  return send({ to: user.email, subject: invite ? "You've been invited to LushTravel" : 'Set a new password', html, text });
};

export const sendPasswordChanged = (user) => {
  const html = renderEmailLayout({
    title: 'Password changed',
    preheader: 'Your LushTravel password was just changed.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;">Password changed</h2>
      <p style="margin:0 0 8px;">Hi ${escapeHtml(user.name)}, your password was just changed.</p>
      <p style="margin:0;padding:12px 16px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;color:#991B1B;">If you didn't make this change, contact support immediately.</p>`,
  });
  const text = `Hi ${user.name}, your password was just changed.\n\nIf you didn't make this change, contact support immediately.${FOOTER_TEXT}`;

  return send({ to: user.email, subject: 'Your password has been changed', html, text })
    .catch((err) => logger.error({ err, email: user.email }, 'Failed to send password-changed notification'));
};

export const sendOTPEmail = (user, otp) => {
  const html = renderEmailLayout({
    title: 'Your Login OTP',
    preheader: 'Your LushTravel login verification code.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;">Login verification code</h2>
      <p style="margin:0 0 16px;">Hi ${escapeHtml(user.name)}, use the code below to complete your login:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">
        <span style="font-family:'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#0578A2;">${escapeHtml(otp)}</span>
      </td></tr></table>
      <p style="margin:16px 0 0;color:#64748B;font-size:13px;">This code expires in 10 minutes. Do not share it with anyone.</p>`,
  });
  const text = `Hi ${user.name}, your login verification code is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.${FOOTER_TEXT}`;

  // No .catch() here: OTP delivery failure is blocking — callers await this
  // and must see the rejection (login can't proceed without the code).
  return send({ to: user.email, subject: 'Your Login OTP', html, text });
};

export const sendLoginNotification = (user) => {
  const html = renderEmailLayout({
    title: 'New login to your account',
    preheader: 'A new login was detected on your LushTravel account.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;">New login detected</h2>
      <p style="margin:0 0 8px;">Hi ${escapeHtml(user.name)}, a new login was just detected on your account.</p>
      <p style="margin:0;padding:12px 16px;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;color:#991B1B;">If this wasn't you, please change your password immediately.</p>`,
  });
  const text = `Hi ${user.name}, a new login was just detected on your account.\n\nIf this wasn't you, please change your password immediately.${FOOTER_TEXT}`;

  return send({ to: user.email, subject: 'New login to your account', html, text })
    .catch((err) => logger.error({ err, email: user.email }, 'Failed to send login notification'));
};

export default {
  sendWelcomeEmail,
  sendEmailVerification,
  sendPasswordReset,
  sendSetPasswordLink,
  sendPasswordChanged,
  sendOTPEmail,
  sendLoginNotification,
};
