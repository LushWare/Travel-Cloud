import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('../../../../services/api', () => ({ authAPI: { sendSetPasswordLink: mockSend } }));

import { sendInvitation } from '../sendInvitation';

beforeEach(() => {
  mockSend.mockReset();
});

describe('sendInvitation', () => {
  it('asks the server to email the new user', async () => {
    mockSend.mockResolvedValue({ status: 'success' });

    expect(await sendInvitation('user-1')).toBe(true);
    expect(mockSend).toHaveBeenCalledWith('user-1');
  });

  it('reports failure instead of throwing when the email cannot be sent', async () => {
    mockSend.mockRejectedValue(new Error('502'));

    expect(await sendInvitation('user-1')).toBe(false);
  });

  it('reports failure when the new user has no id', async () => {
    expect(await sendInvitation(undefined)).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
