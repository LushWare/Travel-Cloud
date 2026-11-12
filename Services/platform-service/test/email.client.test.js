import { describe, expect, it } from 'vitest';
import { sendPlatformSetupEmail } from '../src/utils/email.client.js';

describe('platform staff setup email', () => {
  it('sends an escaped invite link through the authenticated notification relay', async () => {
    const original = {
      token: process.env.INTERNAL_EVENTS_TOKEN,
      consoleUrl: process.env.PLATFORM_CONSOLE_URL,
      nodeEnv: process.env.NODE_ENV,
    };
    process.env.INTERNAL_EVENTS_TOKEN = 'notification-token';
    process.env.PLATFORM_CONSOLE_URL = 'https://console.example.test/';
    process.env.NODE_ENV = 'test';
    let request;
    try {
      await sendPlatformSetupEmail({
        user: { email: 'alex@example.test', name: '<Alex>' }, token: 'opaque_invite_token', purpose: 'invite',
        fetchImpl: async (url, init) => {
          request = { url, init };
          return { ok: true, json: async () => ({ messageId: 'message-1' }) };
        },
      });
    } finally {
      if (original.token === undefined) delete process.env.INTERNAL_EVENTS_TOKEN;
      else process.env.INTERNAL_EVENTS_TOKEN = original.token;
      if (original.consoleUrl === undefined) delete process.env.PLATFORM_CONSOLE_URL;
      else process.env.PLATFORM_CONSOLE_URL = original.consoleUrl;
      if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original.nodeEnv;
    }

    expect(request.url).toBe('http://localhost:3008/api/v1/notifications/internal/email');
    expect(request.init.headers['x-internal-token']).toBe('notification-token');
    const payload = JSON.parse(request.init.body);
    expect(payload.to).toBe('alex@example.test');
    expect(payload.text).toContain('https://console.example.test/#/setup?token=opaque_invite_token');
    expect(payload.html).toContain('&lt;Alex&gt;');
  });
});