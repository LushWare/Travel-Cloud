import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from '@/lib/toast';
import axios from 'axios';
import { Clock, Loader2, ShieldCheck } from 'lucide-react';
import { getLoginBranding } from '../config/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function SalesRepLoginOTP() {
  const navigate = useNavigate();

  const [otpCode, setOtpCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [timer, setTimer] = useState(600); // 10 minutes = 600 seconds
  const [attemptCount, setAttemptCount] = useState(0);
  const [canResendOtp, setCanResendOtp] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  const API_URL = import.meta.env.VITE_API_URL || 'https://api.lushtravelcloud.com/api/v1';

  // Initialize from localStorage
  useEffect(() => {
    const token = localStorage.getItem('otpTempToken');
    const email = localStorage.getItem('otpMaskedEmail');

    if (!token || !email) {
      // No OTP session - redirect to login
      navigate('/login');
      return;
    }

    setTempToken(token);
    setMaskedEmail(email);
    setTimer(600);
    setCanResendOtp(true);
  }, [navigate]);

  // Timer for OTP expiration
  useEffect(() => {
    if (timer === 0) return;

    const interval = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          setError('OTP has expired. Please login again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

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

      console.log('OTP Response:', response.data); // Debug log

      if (response.data.status === 'success') {
        console.log('Login successful, user data:', response.data.data.user); // Debug log

        // Store token and user data directly in localStorage
        localStorage.setItem('token', response.data.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.data.user));

        // Update axios default header
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.data.token}`;

        // Clean up OTP session
        localStorage.removeItem('otpTempToken');
        localStorage.removeItem('otpMaskedEmail');

        toast.success('Login successful!');

        // Wait a moment, then navigate to dashboard
        setTimeout(() => {
          window.location.href = '/'; // Force page reload to update context
        }, 500);
      } else {
        console.error('Unexpected response status:', response.data.status); // Debug log
        throw new Error('Unexpected response from server');
      }
    } catch (err) {
      console.error('OTP Verification Error:', err); // Debug log
      const errorMessage =
        (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data
          ?.message ||
        (err as Error)?.message ||
        'Invalid OTP. Please try again.';
      setError(errorMessage);

      const newAttemptCount = attemptCount + 1;
      setAttemptCount(newAttemptCount);

      if (newAttemptCount < 5) {
        toast.error(`${errorMessage} (${5 - newAttemptCount} attempts remaining)`);
      } else {
        toast.error('Too many failed attempts. Please login again.');
        localStorage.removeItem('otpTempToken');
        localStorage.removeItem('otpMaskedEmail');
        navigate('/login');
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
        setResendTimer(60);
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

  const handleBackToLogin = () => {
    localStorage.removeItem('otpTempToken');
    localStorage.removeItem('otpMaskedEmail');
    navigate('/login');
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
          <p className="text-muted-foreground text-sm">Verify Your Identity</p>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-modal)] p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="font-heading text-xl font-semibold text-foreground mb-2">Enter OTP</h2>
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
                disabled={isSubmitting || timer === 0}
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
              onClick={handleBackToLogin}
              disabled={isSubmitting}
              className="w-full h-10"
            >
              &larr; Back to Login
            </Button>
          </form>

          <div className="mt-6 p-3 bg-primary/10 border border-primary/20 rounded-lg flex gap-2">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-primary">
              <strong>Security:</strong> Never share your OTP code. We will never ask for it via email
              or phone.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
