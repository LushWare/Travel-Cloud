import { z } from 'zod';

const notificationFactKinds = ['id', 'date', 'amount', 'percentage', 'count', 'duration'];
const notificationSections = ['current_state', 'changed', 'attention', 'experienced_view'];
const notificationSeverities = ['info', 'warning', 'critical'];

const NotificationFactSchema = z
  .object({
    kind: z.enum(notificationFactKinds),
    value: z.string().min(1).max(255),
    evidenceId: z.string().min(1).max(255),
    unit: z.enum(['days', 'percent', 'currency']).optional(),
    derivation: z.enum(['grouped-by', 'elapsed-since', 'ratio-of', 'sum-of', 'descriptor-constant']).optional(),
    derivedFrom: z.array(z.string().min(1).max(255)).max(50).optional(),
  })
  .strict();

export const ManagementNotificationCategories = [
  'revenue',
  'pipeline',
  'operations',
  'customer',
  'risk',
];

export const ManagementNotificationTargetSchema = z
  .object({
    path: z.string().min(1).max(200),
    query: z.record(z.string().min(1).max(64), z.string().min(1).max(4000)).optional().default({}),
    label: z.string().min(1).max(60),
  })
  .strict();

export const BusinessNotificationSchema = z
  .object({
    id: z.string().min(1).max(255),
    key: z.string().min(1).max(512),
    category: z.enum(ManagementNotificationCategories),
    severity: z.enum(notificationSeverities),
    section: z.enum(notificationSections),
    text: z.string().min(1).max(2000),
    facts: z.array(NotificationFactSchema).max(20),
    materialValue: z.string().min(1).max(255),
    target: ManagementNotificationTargetSchema.optional(),
    firstSeenAt: z.string().datetime(),
    unread: z.boolean(),
  })
  .strict();

export const ManagementNotificationsRequest = z.object({}).strict();

export const ManagementNotificationsResult = z
  .object({
    generatedAt: z.string().datetime(),
    scope: z.enum(['org', 'own']),
    currency: z.string().min(1).max(8),
    notifications: z.array(BusinessNotificationSchema).max(200),
    unreadCounts: z
      .object({
        critical: z.number().int().min(0),
        warning: z.number().int().min(0),
        info: z.number().int().min(0),
      })
      .strict(),
    unavailableSignals: z.array(z.string().min(1).max(255)).max(50),
  })
  .strict();

export const ManagementNotificationsSeenRequest = z
  .object({
    keys: z.array(z.string().min(1).max(512)).min(1).max(200),
    action: z.enum(['read', 'acknowledge', 'dismiss']),
  })
  .strict();