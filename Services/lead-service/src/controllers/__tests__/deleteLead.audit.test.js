import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, mockAudit } = vi.hoisted(() => ({
  db: { lead: { findUnique: vi.fn(), delete: vi.fn() } },
  mockAudit: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({ default: db }));
vi.mock('../../utils/audit.js', () => ({ audit: mockAudit }));
vi.mock('../../services/notification.client.js', () => ({ sendWhatsappText: vi.fn() }));
vi.mock('../../services/gatekeeper.service.js', () => ({ gatekeeperInputs: vi.fn(), loadPrimarySelection: vi.fn() }));

import { deleteLead } from '../lead.controller.js';

async function run(id) {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  let error;
  await deleteLead({ params: { id }, user: { id: 'admin-1', role: 'admin' } }, res, (err) => { error = err; });
  return { res, error };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.lead.delete.mockResolvedValue({});
});

describe('deleteLead audit', () => {
  it('records the deleted lead by name', async () => {
    db.lead.findUnique.mockResolvedValue({ id: 'lead-9', name: 'Priya Raman' });

    await run('lead-9');

    expect(mockAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'lead.deleted', targetType: 'lead', targetId: 'lead-9', summary: 'Deleted lead Priya Raman',
    }));
  });

  it('names a lead without a name by its id', async () => {
    db.lead.findUnique.mockResolvedValue({ id: 'lead-9', name: null });

    await run('lead-9');

    expect(mockAudit.mock.calls[0][1].summary).toBe('Deleted lead lead-9');
  });

  it('records nothing when the lead does not exist', async () => {
    db.lead.findUnique.mockResolvedValue(null);

    const { error } = await run('missing');

    expect(error.statusCode).toBe(404);
    expect(db.lead.delete).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
