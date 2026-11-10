// A sign-in waiting for the person to pick an agency. Held in memory only: the selection
// token is a short-lived credential, so it never goes into browser storage.
let pending = null;

export const setPendingTenantChoice = ({ selectionToken, tenants }) => {
  pending = { selectionToken, tenants };
};

export const peekPendingTenantChoice = () => pending;

export const clearPendingTenantChoice = () => {
  pending = null;
};

/**
 * Where a successful sign-in response leads: the agency picker, or straight in.
 * @returns {'choose-agency' | 'signed-in' | null}
 */
export function nextStepAfterSignIn(data, setAuth) {
  if (data?.requiresTenantChoice) {
    setPendingTenantChoice(data);
    return 'choose-agency';
  }
  if (data?.user) {
    setAuth(data.user);
    return 'signed-in';
  }
  return null;
}
