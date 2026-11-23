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
describe('platform email on Cloud Run', () => {
  it('sends a Google ID token for notification-service when running on Cloud Run', async () => {
    const { clearCloudRunAuthCache } = await import('../src/utils/cloudRunAuth.js');
    const original = { token: process.env.INTERNAL_EVENTS_TOKEN, service: process.env.K_SERVICE };
    process.env.INTERNAL_EVENTS_TOKEN = 'notification-token';
    process.env.K_SERVICE = 'prod-platform-service';
    clearCloudRunAuthCache();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, text: async () => 'header.e30.signature' });
    let request;
    try {
      const { sendSignupDecisionEmail } = await import('../src/utils/email.client.js');
      await sendSignupDecisionEmail({
        owner: { email: 'owner@example.test', name: 'Owner' }, agencyName: 'Acme', approved: false,
        fetchImpl: async (url, init) => {
          request = { url, init };
          return { ok: true, json: async () => ({ messageId: 'message-2' }) };
        },
      });
    } finally {
      globalThis.fetch = realFetch;
      clearCloudRunAuthCache();
      if (original.token === undefined) delete process.env.INTERNAL_EVENTS_TOKEN;
      else process.env.INTERNAL_EVENTS_TOKEN = original.token;
      if (original.service === undefined) delete process.env.K_SERVICE;
      else process.env.K_SERVICE = original.service;
    }

    expect(request.init.headers.Authorization).toBe('Bearer header.e30.signature');
  });
});
