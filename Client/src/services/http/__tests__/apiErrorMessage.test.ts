import { describe, it, expect } from 'vitest';
import { apiErrorMessage, apiFieldErrors, authErrorMessage } from '../apiErrorMessage';

describe('apiErrorMessage', () => {
  it('reports a network failure when there was no response at all', () => {
    // `isNetworkError: !error.response` is how client.ts reports a timeout or a
    // dead connection — the case axios describes as "Network Error".
    const message = apiErrorMessage({ isNetworkError: true });

    expect(message).toBe("We couldn't reach the server. Check your connection and try again.");
  });

  it('prefers the message the server sent, because the backend makes it safe', () => {
    expect(apiErrorMessage({ status: 400, data: { message: 'That fare is no longer available.' } })).toBe(
      'That fare is no longer available.',
    );
  });

  it.each([
    [400, "We couldn't process that request. Please check the details and try again."],
    [401, 'Your session has expired. Please sign in again.'],
    [403, "You don't have permission to do that."],
    [404, "We couldn't find what you were looking for."],
    [409, 'That conflicts with an existing record. Please refresh and try again.'],
    [429, 'Too many requests. Please wait a moment and try again.'],
  ])('maps status %i to its own sentence', (status, expected) => {
    expect(apiErrorMessage({ status })).toBe(expected);
  });

  it('maps a 5xx with no message to a server-fault sentence', () => {
    expect(apiErrorMessage({ status: 500 })).toBe('Something went wrong on our side. Please try again.');
  });

  it('never returns the axios strings that reach it today', () => {
    const raw = [
      Object.assign(new Error('Request failed with status code 500'), { status: 500 }),
      Object.assign(new Error('Network Error'), { isNetworkError: true }),
      Object.assign(new Error('timeout of 15000ms exceeded'), { isNetworkError: true }),
    ];

    for (const error of raw) {
      const message = apiErrorMessage(error);
      expect(message).not.toBe(error.message);
      expect(message).not.toMatch(/Request failed with status code|Network Error|timeout of/);
    }
  });

  it('handles null, undefined and primitives without throwing', () => {
    for (const value of [null, undefined, 'boom', 42, []]) {
      expect(apiErrorMessage(value).length).toBeGreaterThan(0);
    }
  });
});

describe('apiFieldErrors', () => {
  it('returns the server field detail', () => {
    expect(
      apiFieldErrors({
        data: { errors: [{ field: 'contact.email', message: 'Enter a valid email address' }] },
      }),
    ).toEqual([{ field: 'contact.email', message: 'Enter a valid email address' }]);
  });

  it('reads field details preserved on the enriched HTTP error', () => {
    expect(
      apiFieldErrors({
        errors: [{ field: 'email', message: 'An account with this email already exists.' }],
      }),
    ).toEqual([{ field: 'email', message: 'An account with this email already exists.' }]);
  });

  it('maps local schema issues to readable field details', () => {
    expect(
      apiFieldErrors({
        issues: [{ path: ['confirmPassword'], message: 'Passwords do not match.' }],
      }),
    ).toEqual([{ field: 'confirmPassword', message: 'Passwords do not match.' }]);
  });

  it('drops malformed entries rather than rendering them', () => {
    expect(apiFieldErrors({ data: { errors: [{ field: 'a' }, null, { field: 'b', message: 'ok' }] } })).toEqual([
      { field: 'b', message: 'ok' },
    ]);
  });

  it('returns an empty array when there is nothing to report', () => {
    expect(apiFieldErrors(new Error('boom'))).toEqual([]);
    expect(apiFieldErrors({ data: { errors: 'not-an-array' } })).toEqual([]);
  });
});

describe('authErrorMessage', () => {
  it('explains login credential failures without implying the session expired', () => {
    expect(authErrorMessage({ status: 401 }, 'login')).toBe(
      'Email or password is incorrect. Check your details or reset your password.',
    );
  });

  it('preserves specific backend messages for registration failures', () => {
    expect(
      authErrorMessage({ status: 400, data: { message: 'User with this email already exists' } }, 'register'),
    ).toBe('User with this email already exists');
  });

  it('preserves the deactivated-account message on login', () => {
    expect(
      authErrorMessage(
        { status: 403, data: { message: 'Your account has been deactivated. Please contact support.' } },
        'login',
      ),
    ).toBe('Your account has been deactivated. Please contact support.');
  });
});
