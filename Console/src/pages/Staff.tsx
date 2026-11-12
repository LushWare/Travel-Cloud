import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Plus, RotateCcw, Send, ShieldOff, Trash2, UserRoundPlus } from 'lucide-react';
import { ApiError, staffApi, type PlatformStaff, type PlatformUser } from '../lib/api';
import { formatDate } from '../lib/format';
import AppShell from '../components/AppShell';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type Props = { user: PlatformUser; onSignOut: () => void; onChangePassword: () => void };
type StaffRole = PlatformStaff['role'];
const roleClass = 'h-9 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

export default function Staff({ user, onSignOut, onChangePassword }: Props) {
  const [rows, setRows] = useState<PlatformStaff[]>([]);
  const [roles, setRoles] = useState<Record<string, StaffRole>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('support');
  const [deleting, setDeleting] = useState<PlatformStaff | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const next = await staffApi.list();
      setRows(next);
      setRoles(Object.fromEntries(next.map((staffer) => [staffer.id, staffer.role])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Console staff.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: () => Promise<unknown>, success: string) => {
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The staff change could not be completed.';
      await load();
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('new');
    setError('');
    setNotice('');
    try {
      const invited = await staffApi.invite({ email: email.trim(), name: name.trim(), role: newRole });
      setAdding(false);
      setEmail('');
      setName('');
      setNotice(`Invitation sent to ${invited.email}.`);
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The invitation could not be sent.';
      await load();
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!deleting || deleteConfirmation.trim().toLowerCase() !== deleting.email.toLowerCase()) return;
    setBusy(deleting.id);
    setError('');
    setNotice('');
    try {
      await staffApi.delete(deleting.id);
      setNotice(`${deleting.name}'s account was permanently deleted.`);
      setDeleting(null);
      setDeleteConfirmation('');
      await load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'The account could not be deleted.';
      await load();
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  const statusLabel = (staffer: PlatformStaff) => {
    if (!staffer.isActive) return staffer.setupPurpose === 'invite' ? 'Invite pending' : 'Inactive';
    if (staffer.authenticatorSetupRequired) return 'Authenticator setup pending';
    return 'Active';
  };

  return (
    <AppShell user={user} active="staff" title="Staff" subtitle={`${rows.length} Console ${rows.length === 1 ? 'account' : 'accounts'}`}
      actions={<Button onClick={() => setAdding(true)}><Plus /> Add staff</Button>}
      onChangePassword={onChangePassword} onSignOut={onSignOut}>
      {notice && <p role="status" className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">No staff accounts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Staff member</th>
                <th className="px-4 py-2.5 font-semibold">Role</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Last sign in</th>
                <th className="px-4 py-2.5 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((staffer) => {
                const self = staffer.id === user.id;
                const pendingInvite = !staffer.isActive && staffer.setupPurpose === 'invite';
                return (
                  <tr key={staffer.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{staffer.name}{self && <span className="ml-2 text-xs text-muted-foreground">You</span>}</p>
                      <p className="text-xs text-muted-foreground">{staffer.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select aria-label={`Role for ${staffer.email}`} className={roleClass} value={roles[staffer.id] ?? staffer.role}
                          disabled={self || busy === staffer.id} onChange={(event) => setRoles((current) => ({ ...current, [staffer.id]: event.target.value as StaffRole }))}>
                          <option value="platform_admin">Admin</option>
                          <option value="support">Support</option>
                        </select>
                        {self && <span className="text-xs text-muted-foreground">Your role can’t be changed here.</span>}
                        {!self && roles[staffer.id] !== staffer.role && (
                          <Button size="sm" variant="outline" disabled={busy === staffer.id}
                            onClick={() => act(staffer.id, () => staffApi.changeRole(staffer.id, roles[staffer.id]), `${staffer.name}'s role updated.`)}>
                            Save
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={staffer.isActive && !staffer.authenticatorSetupRequired ? 'text-success' : 'text-muted-foreground'}>{statusLabel(staffer)}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{staffer.lastLoginAt ? formatDate(staffer.lastLoginAt) : 'Never'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {!staffer.isActive && pendingInvite && (
                          <Button size="sm" variant="outline" disabled={busy === staffer.id}
                            onClick={() => act(staffer.id, () => staffApi.resendInvite(staffer.id), `Invitation resent to ${staffer.email}.`)}>
                            {busy === staffer.id ? <Loader2 className="animate-spin" /> : <Send />} Resend invite
                          </Button>
                        )}
                        {staffer.isActive && !self && (
                          <>
                            <Button size="sm" variant="outline" disabled={busy === staffer.id}
                              onClick={() => act(staffer.id, () => staffApi.resetAuthenticator(staffer.id), `Authenticator setup email sent to ${staffer.email}.`)}>
                              {busy === staffer.id ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reset authenticator
                            </Button>
                            <Button size="sm" variant="destructive" disabled={busy === staffer.id}
                              onClick={() => window.confirm(`Deactivate ${staffer.name} (${staffer.email})? Their Console sessions will end.`)
                                && act(staffer.id, () => staffApi.deactivate(staffer.id), `${staffer.name} was deactivated.`)}>
                              <ShieldOff /> Deactivate
                            </Button>
                          </>
                        )}
                        {!self && (
                          <Button size="sm" variant="destructive" disabled={busy === staffer.id}
                            onClick={() => { setDeleting(staffer); setDeleteConfirmation(''); }}>
                            <Trash2 /> Delete permanently
                          </Button>
                        )}
                        {!staffer.isActive && !pendingInvite && <span className="text-xs text-muted-foreground">Inactive</span>}
                        {!staffer.isActive && pendingInvite && (
                          <Button size="sm" variant="destructive" disabled={busy === staffer.id}
                            onClick={() => window.confirm(`Cancel the pending invite for ${staffer.email}?`)
                              && act(staffer.id, () => staffApi.deactivate(staffer.id), `Invitation for ${staffer.email} was cancelled.`)}>
                            <ShieldOff /> Cancel invite
                          </Button>
                        )}
                        {self && <span className="text-xs text-muted-foreground">Use another platform admin account to manage this account.</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="add-staff-title" className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center gap-2">
              <UserRoundPlus className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 id="add-staff-title" className="font-heading text-lg font-semibold">Invite staff</h2>
            </div>
            <form onSubmit={invite} className="space-y-4">
              <div>
                <label htmlFor="staff-name" className="mb-1.5 block text-sm font-medium">Full name</label>
                <Input id="staff-name" autoComplete="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div>
                <label htmlFor="staff-email" className="mb-1.5 block text-sm font-medium">Email</label>
                <Input id="staff-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div>
                <label htmlFor="staff-role" className="mb-1.5 block text-sm font-medium">Role</label>
                <select id="staff-role" className={`${roleClass} w-full`} value={newRole} onChange={(event) => setNewRole(event.target.value as StaffRole)}>
                  <option value="support">Support</option>
                  <option value="platform_admin">Admin</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground">They’ll receive a one-time email link to set a password and enroll an authenticator app.</p>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" disabled={busy === 'new'} onClick={() => setAdding(false)}>Cancel</Button>
                <Button type="submit" disabled={busy === 'new'}>{busy === 'new' ? <Loader2 className="animate-spin" /> : <Send />} Send invite</Button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="delete-staff-title" className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-3 flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
              <h2 id="delete-staff-title" className="font-heading text-lg font-semibold">Delete staff account?</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              This permanently removes {deleting.name}, ends their Console sessions and any active help access, and cannot be undone. Audit history is retained.
            </p>
            <form onSubmit={deleteAccount} className="space-y-4">
              <div>
                <label htmlFor="delete-staff-confirmation" className="mb-1.5 block text-sm font-medium">
                  Type <span className="font-mono">{deleting.email}</span> to confirm
                </label>
                <Input id="delete-staff-confirmation" autoComplete="off" value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" disabled={busy === deleting.id}
                  onClick={() => { setDeleting(null); setDeleteConfirmation(''); }}>Cancel</Button>
                <Button type="submit" variant="destructive" disabled={busy === deleting.id || deleteConfirmation.trim().toLowerCase() !== deleting.email.toLowerCase()}>
                  {busy === deleting.id ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete permanently
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </AppShell>
  );
}