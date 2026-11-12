import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { ApiError, authApi, type StaffSetupInfo } from '../lib/api';
import AuthCard, { FormError } from '../components/AuthCard';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type Props = { token: string };

export default function StaffSetup({ token }: Props) {
  const [setup, setSetup] = useState<StaffSetupInfo | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(token));
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This setup link is incomplete. Ask your administrator to send another.');
      setLoading(false);
      return;
    }
    authApi.getStaffSetup(token)
      .then(setSetup)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'This setup link could not be opened.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!setup) return;
    if (setup.requiresPassword && password.length < 12) return setError('Use at least 12 characters for your password.');
    if (setup.requiresPassword && password !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    setError('');
    try {
      await authApi.completeStaffSetup(token, code, setup.requiresPassword ? password : undefined);
      setComplete(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>;
  }

  if (complete) {
    return <AuthCard title="Setup complete" subtitle="Your Lush Console account is ready.">
      <Button size="xl" className="w-full" onClick={() => { window.location.hash = '#/'; }}>Continue to sign in</Button>
    </AuthCard>;
  }

  return (
    <AuthCard title={setup?.requiresPassword ? 'Set up your Console access' : 'Reset your authenticator'} subtitle={setup?.email ?? 'Secure account setup'}>
      <FormError message={error} />
      {setup && (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" aria-hidden="true" /> Authenticator setup key</div>
            <p className="font-mono text-sm break-all">{setup.secret}</p>
            <p className="mt-2 text-xs text-muted-foreground">Add this key to Google or Microsoft Authenticator, then enter the current 6-digit code below.</p>
          </div>
          {setup.requiresPassword && <>
            <div>
              <label htmlFor="setup-password" className="mb-1.5 block text-sm font-medium">Create password</label>
              <Input id="setup-password" type="password" autoComplete="new-password" required minLength={12} value={password}
                onChange={(event) => setPassword(event.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">Use at least 12 characters.</p>
            </div>
            <div>
              <label htmlFor="setup-confirm" className="mb-1.5 block text-sm font-medium">Confirm password</label>
              <Input id="setup-confirm" type="password" autoComplete="new-password" required value={confirm}
                onChange={(event) => setConfirm(event.target.value)} />
            </div>
          </>}
          <div>
            <label htmlFor="setup-code" className="mb-1.5 block text-sm font-medium">6-digit authenticator code</label>
            <div className="relative">
              <ShieldCheck className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="setup-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="h-11 pl-9 font-mono text-lg" />
            </div>
          </div>
          <Button type="submit" size="xl" disabled={busy || code.length !== 6} className="w-full">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Complete setup
          </Button>
        </form>
      )}
    </AuthCard>
  );
}