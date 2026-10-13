import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from '@/lib/toast';
import axios from 'axios';
import { Eye, EyeOff, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { getLoginBranding } from '../config/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Only show test credentials in development when explicitly enabled
const showTestCredentials = import.meta.env.VITE_SHOW_TEST_CREDENTIALS === 'true';

type Step = 'credentials' | 'otp';

export default function SalesRepLogin() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  const [step, setStep] = useState<Step>('credentials');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [otpCode, setOtpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [timer, setTimer] = useState(600); // 10 minutes = 600 seconds
  const [attemptCount, setAttemptCount] = useState(0);
  const [canResendOtp, setCanResendOtp] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  const API_URL = import.meta.env.VITE_API_URL || 'https://api.lushtravelcloud.com/api/v1';

  // Timer for OTP expiration
  useEffect(() => {
    if (step !== 'otp' || timer === 0) return;

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          setError('OTP has expired. Please request a new one.');
          setStep('credentials');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step, timer]);

  // Timer for resend OTP button
  useEffect(() => {
    if (resendTimer === 0) {
      setCanResendOtp(true);
      return;
    }

    const interval = setInterval(() => {
      setResendTimer((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [resendTimer]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCredentialsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setError('');
  };

  const validateCredentials = () => {
    if (!formData.email.trim()) {
      setError('Email is required');
      return false;
    }

    if (!formData.email.includes('@')) {
      setError('Please enter a valid email address');
      return false;
    }

    if (!formData.password) {
      setError('Password is required');
      return false;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return false;
    }

    return true;
  };

  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateCredentials()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await axios.post(`${API_URL}/auth/login-step1`, formData);

      if (response.data.status === 'success') {
        setTempToken(response.data.data.tempToken);
        setMaskedEmail(response.data.data.maskedEmail);
        setTimer(response.data.data.expiresIn || 600);
        setStep('otp');
        setOtpCode('');
        setAttemptCount(0);
        setResendTimer(0);
        setCanResendOtp(true);
        toast.success('OTP sent to your email');
      }
    } catch (err) {
      const errorMessage =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to send OTP. Please try again.';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const validateOTP = () => {
    if (!otpCode.trim()) {
      setError('OTP is required');
      return false;
    }

    if (otpCode.length !== 6) {
      setError('OTP must be 6 digits');
      return false;
    }

    if (!/^\d{6}$/.test(otpCode)) {
      setError('OTP must contain only digits');
      return false;
    }

    return true;
  };

  const handleOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateOTP()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await axios.post(`${API_URL}/auth/login-step2`, {
        tempToken,
        otp: otpCode,
      });

      if (response.data.status === 'success') {
        localStorage.setItem('token', response.data.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.data.user));

        if (setAuth) {
          setAuth(response.data.data.user, response.data.data.token);
        }

        toast.success('Login successful!');
        navigate('/');
      }
    } catch (err) {
      const errorMessage =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Invalid OTP. Please try again.';
      setError(errorMessage);

      const newAttemptCount = attemptCount + 1;
      setAttemptCount(newAttemptCount);

      if (newAttemptCount < 5) {
        toast.error(`${errorMessage} (${5 - newAttemptCount} attempts remaining)`);
      } else {
        toast.error('Too many failed attempts. Please request a new OTP.');
        setStep('credentials');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!canResendOtp) return;

    setError('');
    setIsSubmitting(true);
    setCanResendOtp(false);

    try {
      const response = await axios.post(`${API_URL}/auth/resend-otp`, {
        tempToken,
      });

      if (response.data.status === 'success') {
        setTimer(response.data.data.expiresIn || 600);
        setOtpCode('');
        setAttemptCount(0);
        setResendTimer(60); // Disable resend button for 60 seconds
        toast.success('New OTP sent to your email');
      }
    } catch (err) {
      const errorMessage =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to resend OTP. Please try again.';
      setError(errorMessage);
      toast.error(errorMessage);
      setCanResendOtp(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackToCredentials = () => {
    setStep('credentials');
    setOtpCode('');
    setError('');
    setTimer(600);
    setAttemptCount(0);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 sm:mb-8">
          <div className="mb-2 flex items-center justify-center gap-3">
            <img src="/logo.jpeg" alt="" className="h-10 w-10 shrink-0 object-contain" />
            <h1 className="font-heading text-xl font-bold text-foreground">
              {getLoginBranding().title}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">Sales Representative Portal</p>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-modal)] p-6 sm:p-8">
          {step === 'credentials' ? (
            <>
              <h2 className="font-heading text-xl font-semibold text-foreground mb-6">Sign In</h2>

              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                    Email Address
                  </label>
                  <Input
                    id="email"
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleCredentialsChange}
                    placeholder="you@example.com"
                    className="h-10"
                    disabled={isSubmitting}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={formData.password}
                      onChange={handleCredentialsChange}
                      placeholder="********"
                      className="h-10 pr-9"
                      disabled={isSubmitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      disabled={isSubmitting}
                      aria-label={showPassword ? 'Hide input' : 'Show input'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <Button type="submit" disabled={isSubmitting} className="w-full h-10 gap-2">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Next: Verify with OTP'
                  )}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="font-heading text-xl font-semibold text-foreground mb-2">Verify OTP</h2>
                <p className="text-muted-foreground text-sm">
                  We&apos;ve sent a 6-digit code to <strong className="text-foreground">{maskedEmail}</strong>
                </p>
              </div>

              <form onSubmit={handleOtpSubmit} className="space-y-4">
                <div>
                  <label htmlFor="otp" className="block text-sm font-medium text-foreground mb-2">
                    Enter 6-Digit OTP
                  </label>
                  <Input
                    id="otp"
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, '');
                      setOtpCode(value);
                      setError('');
                    }}
                    placeholder="000000"
                    className="h-14 text-center text-2xl sm:text-3xl font-mono font-bold tracking-widest"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center text-muted-foreground">
                    <Clock size={16} className="mr-2" />
                    <span>
                      {timer > 0 ? (
                        <>
                          Expires in <strong className="ml-1 text-foreground">{formatTime(timer)}</strong>
                        </>
                      ) : (
                        <span className="text-destructive">OTP expired</span>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={!canResendOtp || isSubmitting || timer === 0}
                    className={`font-medium transition-colors ${
                      canResendOtp && timer > 0
                        ? 'text-primary hover:text-primary/80 cursor-pointer'
                        : 'text-muted-foreground cursor-not-allowed'
                    }`}
                  >
                    {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                  </button>
                </div>

                {attemptCount > 0 && attemptCount < 5 && (
                  <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
                    <p className="text-sm text-warning">
                      {5 - attemptCount} attempt{5 - attemptCount !== 1 ? 's' : ''} remaining
                    </p>
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isSubmitting || otpCode.length !== 6 || timer === 0}
                  className="w-full h-10 gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Complete Login'
                  )}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleBackToCredentials}
                  disabled={isSubmitting}
                  className="w-full h-10"
                >
                  &larr; Back to Email &amp; Password
                </Button>
              </form>

              <div className="mt-6 p-3 bg-primary/10 border border-primary/20 rounded-lg flex gap-2">
                <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-primary">
                  <strong>Security:</strong> Never share your OTP code. We will never ask for it via
                  email or phone.
                </p>
              </div>
            </>
          )}

          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-center text-sm text-muted-foreground">
              Authorized personnel only. All access is monitored and logged.
            </p>
          </div>
        </div>

        {step === 'credentials' && showTestCredentials && (
          <div className="mt-6 bg-warning/10 border border-warning/20 rounded-lg p-4">
            <p className="text-sm text-warning font-medium mb-2">
              Test Sales Rep Credentials (Development Only):
            </p>
            <div className="grid grid-cols-1 gap-1 text-xs text-warning">
              <p>
                Email: <code className="bg-card px-1.5 py-0.5 rounded">salesrep@example.com</code>
              </p>
              <p>
                Password: <code className="bg-card px-1.5 py-0.5 rounded">Sales@123456</code>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
