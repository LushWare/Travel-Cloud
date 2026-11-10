// The temporary password from a first login, held in memory only (never in browser storage).
let pending = null;

export const setPendingPasswordReset = (email, tempPassword) => {
  pending = { email, tempPassword };
};

export const peekPendingPasswordReset = () => pending;

export const clearPendingPasswordReset = () => {
  pending = null;
};
