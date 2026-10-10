import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { requestPasswordReset, resetPassword } from '../services/api/auth';
import { apiErrorMessage } from '../services/http/apiErrorMessage';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

const fieldClass =
  'mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10';

export default function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { token = '' } = useParams();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>(
    location.pathname === '/register' ? 'register' : location.pathname.startsWith('/reset-password/') ? 'reset' : 'login',
  );
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
    if (nextMode === 'register') navigate('/register');
    else if (nextMode === 'login') navigate('/login');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login({ email, password });
        navigate('/');
      } else if (mode === 'register') {
        await register({ name, email, phone, password, confirmPassword });
        navigate('/');
      } else if (mode === 'forgot') {
        setNotice(await requestPasswordReset(email));
      } else {
        const result = await resetPassword(token, password);
        setNotice('Your password has been updated. You can now sign in.');
        setPassword('');
        setConfirmPassword('');
        setMode('login');
        navigate('/login', { replace: true });
        void result;
      }
    } catch (submitError) {
      setError(apiErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const heading =
    mode === 'register' ? 'Create your account' :
      mode === 'forgot' ? 'Reset your password' :
        mode === 'reset' ? 'Choose a new password' : 'Welcome back';
  const description =
    mode === 'register' ? 'Create an account to keep your travel plans close.' :
      mode === 'forgot' ? 'Enter your email and we’ll send reset instructions if an account exists.' :
        mode === 'reset' ? 'Choose a secure password for your account.' :
          'Sign in to continue planning your next journey.';

  return (
    <>
      <main className="flex min-h-[100svh] items-center justify-center bg-brand-50 px-5 pb-12 pt-28 sm:px-6 sm:pt-32">
        <section className={`w-full ${mode === 'register' ? 'max-w-[40rem]' : 'max-w-lg'} rounded-2xl border border-slate-400 bg-white p-6 shadow-xl shadow-slate-900/10 sm:p-10`}>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            LushTravelCloud
          </p>
          <h1 className="font-serif text-3xl text-slate-900">{heading}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>

          {(mode === 'login' || mode === 'register') && (
            <div className="mt-7 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => switchMode('login')}
                aria-pressed={mode === 'login'}
                className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                aria-pressed={mode === 'register'}
                className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Register
              </button>
            </div>
          )}

          <form
            className={`mt-7 ${mode === 'register' ? 'grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2' : 'flex flex-col gap-5'}`}
            onSubmit={submit}
          >
            {(mode === 'register') && (
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Full name
                  <input autoComplete="name" className={fieldClass} required value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            )}

            {mode !== 'reset' && (
              <label className="block text-sm font-medium text-slate-700">
                Email address
                <input
                  autoComplete="email"
                  className={fieldClass}
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            )}

            {(mode === 'register') && (
              <label className="block text-sm font-medium text-slate-700">
                Phone number <span className="text-slate-400">(optional)</span>
                <input autoComplete="tel" className={fieldClass} value={phone} onChange={(event) => setPhone(event.target.value)} />
              </label>
            )}

            <div className={mode === 'register' ? 'grid gap-y-4 sm:col-span-2 sm:grid-cols-2 sm:gap-x-5' : 'contents'}>
              {mode !== 'forgot' && (
                <label className="block text-sm font-medium text-slate-700">
                  Password
                  <span className="relative mt-2 block">
                    <input
                      autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'}
                      className={`${fieldClass} mt-0 pr-12`}
                      type={showPassword ? 'text' : 'password'}
                      minLength={mode === 'reset' ? 8 : 1}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-emerald-700"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </span>
                </label>
              )}

              {(mode === 'register' || mode === 'reset') && (
                <label className="block text-sm font-medium text-slate-700">
                  Confirm password
                  <input
                    autoComplete="new-password"
                    className={fieldClass}
                    type="password"
                    minLength={mode === 'reset' ? 8 : 1}
                    required
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
              )}
            </div>

            {error && <p role="alert" className={`rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ${mode === 'register' ? 'sm:col-span-2' : ''}`}>{error}</p>}
            {notice && <p role="status" className={`rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ${mode === 'register' ? 'sm:col-span-2' : ''}`}>{notice}</p>}

            <button
              type="submit"
              disabled={submitting}
              className={`flex w-full items-center justify-center gap-2 rounded-md bg-[#16a34a] px-6 py-3.5 font-semibold text-white transition-colors hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-60 ${mode === 'register' ? 'sm:col-span-2' : ''}`}
            >
              {submitting ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : mode === 'forgot' ? 'Send Reset Link' : 'Update Password'}
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          <div className="mt-6 flex flex-wrap justify-between gap-3 text-sm">
            {mode === 'login' && (
              <>
                <button type="button" onClick={() => switchMode('forgot')} className="text-emerald-700 hover:underline">
                  Forgot password?
                </button>
                <button type="button" onClick={() => switchMode('register')} className="text-emerald-700 hover:underline">
                  Create an account
                </button>
              </>
            )}
            {mode === 'forgot' && (
              <button type="button" onClick={() => switchMode('login')} className="text-emerald-700 hover:underline">
                Back to sign in
              </button>
            )}
            {mode === 'register' && (
              <button type="button" onClick={() => switchMode('login')} className="text-emerald-700 hover:underline">
                Already have an account? Sign in
              </button>
            )}
            {mode === 'reset' && <Link to="/login" className="text-emerald-700 hover:underline">Back to sign in</Link>}
          </div>
        </section>
      </main>
    </>
  );
}
