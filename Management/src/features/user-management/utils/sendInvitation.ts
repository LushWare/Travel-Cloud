import { authAPI } from '../../../services/api';

/** Emails a newly created staff member their set-password link. Resolves to false if it could not be sent. */
export async function sendInvitation(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    await authAPI.sendSetPasswordLink(userId);
    return true;
  } catch {
    return false;
  }
}
