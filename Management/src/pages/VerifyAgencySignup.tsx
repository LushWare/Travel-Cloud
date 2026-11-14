import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '../contexts/AuthContext';
import authService from '../services/auth.service';

export default function VerifyAgencySignup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, setAuth } = useAuth();
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  if (isAuthenticated) return <Navigate to="/" replace />;

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const response = await authService.verifyAgencySignup(email, code);
      setAuth(response.data.user);
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The code could not be verified.');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setError('');
    setMessage('');
    try {
      const response = await authService.resendAgencySignupCode(email);
      setMessage(response.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'A new code could not be sent.');
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border p-6 sm:p-8">
        <div className="mb-6 text-center">
          <MailCheck className="mx-auto mb-3 h-8 w-8 text-primary" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-bold text-foreground">Verify your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the six-digit code we sent to finish creating your agency.
          </p>
        </div>

        <form onSubmit={verify} className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Email address</span>
            <Input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Verification code</span>
            <Input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              aria-label="Six-digit verification code"
            />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          <Button type="submit" className="w-full gap-2" disabled={submitting || code.length !== 6}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Verifying…' : 'Verify and open your agency'}
          </Button>
        </form>

        <Button type="button" variant="outline" className="mt-3 w-full" onClick={resend} disabled={resending || !email}>
          {resending ? 'Sending…' : 'Resend code'}
        </Button>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
