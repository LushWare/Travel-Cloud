import { useState, type FormEvent } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { ApiError, authApi, MIN_PASSWORD_LENGTH, type PlatformUser } from '../lib/api';
import AuthCard, { FormError } from '../components/AuthCard';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type Props = {
  user: PlatformUser;
  // First sign-in with a temporary password: there is no way back, only "set it" or sign out.
  required: boolean;
  onDone: (user: PlatformUser) => void;
  onCancel: () => void;
};

const iconClass = 'pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground';

function PasswordField({ id, label, value, onChange, autoComplete, describedBy }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; describedBy?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <Lock className={iconClass} aria-hidden="true" />
        <Input id={id} type="password" autoComplete={autoComplete} required value={value}
          aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} className="h-11 pl-9" />
      </div>
    </div>
  );
}

export default function ChangePassword({ user, required, onDone, onCancel }: Props) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    setError('');
    try {
      const { user: updated } = await authApi.changePassword(current, next);
      onDone({ ...user, ...updated, mustChangePassword: false });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={required ? 'Set your own password' : 'Change password'}
      subtitle={required ? 'You signed in with a temporary password. Choose your own to continue.' : user.email}
    >
      <FormError message={error} />
      <form onSubmit={submit} className="space-y-4">
        <PasswordField id="current" label={required ? 'Temporary password' : 'Current password'}
          value={current} onChange={setCurrent} autoComplete="current-password" />
        <div className="space-y-1.5">
          <PasswordField id="new" label="New password" value={next} onChange={setNext} autoComplete="new-password" describedBy="new-password-hint" />
          <p id="new-password-hint" className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters. A short phrase works well, e.g. blue-train-sunset-2026.
          </p>
        </div>
        <PasswordField id="confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <Button type="submit" size="xl" disabled={busy} className="w-full">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save password
        </Button>
        <div className="border-t border-border pt-4 text-center">
          <Button variant="link" onClick={onCancel}>{required ? 'Sign out' : 'Cancel'}</Button>
        </div>
      </form>
    </AuthCard>
  );
}
