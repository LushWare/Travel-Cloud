import crypto from 'node:crypto';

// No lookalike characters (0/O, 1/l/I), so a password read off the screen is typed correctly.
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const MIN_LENGTH = 12;
export const MAX_LENGTH = 200;

// Kept short on purpose: length does most of the work; these catch the obvious ones.
const COMMON = ['password', 'qwerty', '123456', 'letmein', 'welcome', 'admin', 'lushware', 'lushtravel', 'travelcloud', 'console'];

/**
 * Why a chosen password is not acceptable, or null when it is. Follows current guidance: long beats
 * complicated, so there are no "must contain a symbol" rules, only length and a few refusals.
 */
export function passwordProblem(password, { email = '', current = '' } = {}) {
  const value = String(password ?? '');
  if (value.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (value.length > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters.`;
  if (current && value === current) return 'Choose a password different from your current one.';
  const lower = value.toLowerCase();
  const name = String(email).split('@')[0].toLowerCase();
  if (name.length >= 3 && lower.includes(name)) return "Don't include your email name in your password.";
  if (/^(.)\1+$/.test(value)) return "Don't use the same character over and over.";
  // A common word dressed up with digits or symbols ("Password2026!") is still a common word.
  if (COMMON.includes(lower.replace(/[^a-z]/g, ''))) return 'That password is too easy to guess. Try a longer phrase.';
  return null;
}

/** A generated password: 20 random characters plus a digit, a letter and a symbol for any policy. */
export function generatePassword() {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % CHARS.length);
  let body = '';
  while (body.length < 20) {
    for (const byte of crypto.randomBytes(32)) {
      if (byte < limit && body.length < 20) body += CHARS[byte % CHARS.length];
    }
  }
  return `${body}-9a`;
}
