import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Loader2, Lock } from 'lucide-react';
import toast from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_BASE_URL, authFetch } from '@/lib/authFetch';
import { nextStepAfterSignIn } from '@/lib/pendingTenantChoice';
import { useAuth } from '../contexts/AuthContext';

const MIN_LENGTH = 12;

export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Use both letters and numbers.';
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

export default function SetPassword() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    setError(problem);
    if (problem) return;

    setSubmitting(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/auth/reset-password/${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message || 'This link is invalid or has expired. Ask your administrator for a new one.');
        return;
      }
      const step = nextStepAfterSignIn(body.data, setAuth);
      toast.success('Your password is set. Welcome!');
      navigate(step === 'choose-agency' ? '/choose-agency' : '/');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-3 rounded-lg">
              <Lock className="text-primary" size={24} />
            </div>
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground mb-1">Set your password</h1>
          <p className="text-muted-foreground text-sm">Choose a password to sign in to LushTravel.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-5 sm:p-8 space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">New password</label>
            <div className="relative">
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="h-10 pr-9"
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">At least {MIN_LENGTH} characters, with letters and numbers.</p>
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-foreground mb-1.5">Confirm password</label>
            <Input
              id="confirm"
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="h-10"
              disabled={submitting}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle size={14} />
              {error}
            </p>
          )}

          <Button type="submit" className="w-full h-10" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" size={16} /> : 'Set password and sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
