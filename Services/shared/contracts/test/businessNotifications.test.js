import { describe, expect, it } from 'vitest';
import {
  BusinessNotificationSchema,
  ManagementNotificationsRequest,
  ManagementNotificationsResult,
  ManagementNotificationsSeenRequest,
} from '../src/businessNotifications.js';

const notification = {
  id: 'overdue-invoices',
  key: 'overdue-invoices',
  category: 'revenue',
  severity: 'warning',
  section: 'attention',
  text: 'Invoices are overdue.',
  facts: [{ kind: 'count', value: '3', evidenceId: 'billing:aggregate:overdue:value' }],
  materialValue: '3 invoices',
  target: { path: '/billing', query: {}, label: 'Review invoices' },
  firstSeenAt: '2026-10-12T00:00:00.000Z',
  unread: true,
};

describe('business notification contracts', () => {
  it('accepts the empty request used to fetch notifications', () => {
    expect(ManagementNotificationsRequest.parse({})).toEqual({});
  });

  it('accepts a verified notification envelope', () => {
    const result = {
      generatedAt: '2026-10-12T00:00:00.000Z',
      scope: 'org',
      currency: 'USD',
      notifications: [notification],
      unreadCounts: { critical: 0, warning: 1, info: 0 },
      unavailableSignals: [],
    };
    expect(ManagementNotificationsResult.parse(result)).toEqual(result);
  });

  it('rejects invalid notification categories and unknown fields', () => {
    expect(() => BusinessNotificationSchema.parse({ ...notification, category: 'generic' })).toThrow();
    expect(() => BusinessNotificationSchema.parse({ ...notification, fabricated: true })).toThrow();
  });

  it('accepts only bounded notification state updates', () => {
    expect(ManagementNotificationsSeenRequest.parse({ keys: ['overdue-invoices'], action: 'read' })).toEqual({
      keys: ['overdue-invoices'],
      action: 'read',
    });
    expect(() => ManagementNotificationsSeenRequest.parse({ keys: [], action: 'read' })).toThrow();
    expect(() => ManagementNotificationsSeenRequest.parse({ keys: ['overdue-invoices'], action: 'send' })).toThrow();
  });
});