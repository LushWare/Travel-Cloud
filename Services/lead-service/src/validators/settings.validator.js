import { z } from 'zod';

export const updateSettingsSchema = z.object({
  assignmentMode: z.enum(['manual', 'auto']).optional(),
  autoStrategy: z.enum(['round_robin', 'load_based']).optional(),
  enabledSalesRepIds: z.array(z.string().min(1).max(64)).max(500).optional(),
  maxOpenLeadsPerRep: z.number().int().min(1).optional(),
  skipInactive: z.boolean().optional(),
  requireActiveLogin48h: z.boolean().optional(),
});
