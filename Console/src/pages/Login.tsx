import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, Mail } from 'lucide-react';
import { ApiError, authApi, type PlatformUser } from '../lib/api';
import AuthCard, { FormError } from '../components/AuthCard';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

type Props = { onSignedIn: (user: PlatformUser) => void };

const iconClass = 'pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground';

export default function Login({ onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  // Held in memory only: a reload starts sign-in again.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { challenge: next } = await authApi.login(email.trim(), password);
      setPassword('');
      setChallenge(next);
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    run(async () => {
      try {
        const { user } = await authApi.verifyCode(challenge, code.trim());
        onSignedIn(user);
      } catch (err) {
        setCode('');
        // An expired step one sends the person back to the start.
        if (err instanceof ApiError && /start again/i.test(err.message)) setChallenge(null);
        throw err;
      }
    });
  };

  if (!challenge) {
    return (
      <AuthCard title="Welcome back" subtitle="Sign in to the platform console">
        <FormError message={error} />
        <form onSubmit={submitPassword} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">Email</label>
            <div className="relative">
              <Mail className={iconClass} aria-hidden="true" />
              <Input id="email" type="email" autoComplete="username" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@lushware.com" className="h-11 pl-9" />
            </div>
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">Password</label>
            <div className="relative">
              <Lock className={iconClass} aria-hidden="true" />
              <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 pr-9 pl-9" />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" size="xl" disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Next
            {!busy && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app">
      <FormError message={error} />
      <form onSubmit={submitCode} className="space-y-4">
        <div>
          <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-foreground">Code</label>
          <div className="relative">
            <KeyRound className={iconClass} aria-hidden="true" />
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="h-11 pl-9 font-mono text-lg tracking-[0.4em]" />
          </div>
        </div>
        <Button type="submit" size="xl" disabled={busy || code.length !== 6} className="w-full">
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Sign in
        </Button>
        <div className="border-t border-border pt-4 text-center">
          <Button variant="link" onClick={() => { setChallenge(null); setCode(''); setError(''); }}>
            Use a different account
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
