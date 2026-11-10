import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, AlertCircle, CheckCircle, Eye, EyeOff, ArrowLeft, Loader2 } from 'lucide-react';
import toast from '@/lib/toast';
import authService from '../services/auth.service';
import { clearPendingPasswordReset, peekPendingPasswordReset } from '@/lib/pendingPasswordReset';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface FormErrors {
  email?: string;
  tempPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [errors, setErrors] = useState<FormErrors>({});

  const [formData, setFormData] = useState(() => {
    const pending = peekPendingPasswordReset();
    return {
      email: pending?.email || '',
      tempPassword: pending?.tempPassword || '',
      newPassword: '',
      confirmPassword: '',
    };
  });

  // Redirect to login if there is no pending reset from this session
  useEffect(() => {
    localStorage.removeItem('resetEmail');
    localStorage.removeItem('tempPassword');
    if (!formData.email || !formData.tempPassword) {
      toast.error('No pending password reset. Please log in first.');
      navigate('/login');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const calculatePasswordStrength = (password: string) => {
    let strength = 0;

    if (password.length >= 12) strength += 20;
    if (/[A-Z]/.test(password)) strength += 20;
    if (/[a-z]/.test(password)) strength += 20;
    if (/[0-9]/.test(password)) strength += 20;
    if (/[!@#$%^&*]/.test(password)) strength += 20;

    return strength;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (name === 'newPassword') {
      setPasswordStrength(calculatePasswordStrength(value));
    }

    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  const validateForm = () => {
    const newErrors: FormErrors = {};

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!formData.email.includes('@')) {
      newErrors.email = 'Invalid email address';
    }

    if (!formData.tempPassword) {
      newErrors.tempPassword = 'Temporary password is required';
    }

    if (!formData.newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (formData.newPassword.length < 12) {
      newErrors.newPassword = 'Password must be at least 12 characters';
    } else if (!/[A-Z]/.test(formData.newPassword)) {
      newErrors.newPassword = 'Must contain at least one uppercase letter';
    } else if (!/[a-z]/.test(formData.newPassword)) {
      newErrors.newPassword = 'Must contain at least one lowercase letter';
    } else if (!/[0-9]/.test(formData.newPassword)) {
      newErrors.newPassword = 'Must contain at least one number';
    } else if (!/[!@#$%^&*]/.test(formData.newPassword)) {
      newErrors.newPassword = 'Must contain at least one special character (!@#$%^&*)';
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await authService.resetPassword({
        email: formData.email,
        currentPassword: formData.tempPassword,
        newPassword: formData.newPassword,
        confirmPassword: formData.confirmPassword,
      });

      if (response.status === 'success') {
        clearPendingPasswordReset();

        toast.success('Password reset successfully! Please log in with your new password.');
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      } else {
        toast.error(response.message || 'Failed to reset password');
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      toast.error((error as Error)?.message || 'An error occurred while resetting password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPasswordStrengthColor = () => {
    if (passwordStrength < 40) return 'bg-destructive';
    if (passwordStrength < 80) return 'bg-warning';
    return 'bg-success';
  };

  const getPasswordStrengthTextColor = () => {
    if (passwordStrength < 40) return 'text-destructive';
    if (passwordStrength < 80) return 'text-warning';
    return 'text-success';
  };

  const getPasswordStrengthText = () => {
    if (passwordStrength < 40) return 'Weak';
    if (passwordStrength < 80) return 'Fair';
    return 'Strong';
  };

  const requirements = [
    { met: formData.newPassword.length >= 12, label: 'At least 12 characters' },
    { met: /[A-Z]/.test(formData.newPassword), label: 'Uppercase letter (A-Z)' },
    { met: /[a-z]/.test(formData.newPassword), label: 'Lowercase letter (a-z)' },
    { met: /[0-9]/.test(formData.newPassword), label: 'Number (0-9)' },
    { met: /[!@#$%^&*]/.test(formData.newPassword), label: 'Special character (!@#$%^&*)' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <button
          onClick={() => navigate('/login')}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 sm:mb-8 transition-colors"
        >
          <ArrowLeft size={18} />
          <span className="text-sm">Back to Login</span>
        </button>

        <div className="text-center mb-4 sm:mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-3 rounded-lg">
              <Lock className="text-primary" size={24} />
            </div>
          </div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-1">
            Reset Password
          </h1>
          <p className="text-muted-foreground text-sm">Set your new permanent password</p>
        </div>

        <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-primary/10 border border-primary/20 rounded-lg flex gap-3">
          <AlertCircle className="text-primary shrink-0 mt-0.5" size={18} />
          <div>
            <p className="text-sm text-foreground font-medium">First Time Setup</p>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              You received a temporary password via email. Use it here along with your new
              permanent password.
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-[var(--shadow-modal)] p-5 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="your@email.com"
                aria-invalid={!!errors.email}
                className="h-10"
                disabled={isSubmitting}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-destructive flex items-center gap-1">
                  <AlertCircle size={14} />
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="tempPassword" className="block text-sm font-medium text-foreground mb-1.5">
                Temporary Password (from email)
              </label>
              <Input
                id="tempPassword"
                type="password"
                name="tempPassword"
                value={formData.tempPassword}
                onChange={handleChange}
                placeholder="********"
                aria-invalid={!!errors.tempPassword}
                className="h-10"
                disabled={isSubmitting}
              />
              {errors.tempPassword && (
                <p className="mt-1 text-sm text-destructive flex items-center gap-1">
                  <AlertCircle size={14} />
                  {errors.tempPassword}
                </p>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-card text-muted-foreground">New Password</span>
              </div>
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-1.5">
                New Password
              </label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleChange}
                  placeholder="************"
                  aria-invalid={!!errors.newPassword}
                  className="h-10 pr-9"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isSubmitting}
                  aria-label={showPassword ? 'Hide new entry' : 'Show new entry'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {formData.newPassword && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      Password Strength:
                    </span>
                    <span className={`text-xs font-bold ${getPasswordStrengthTextColor()}`}>
                      {getPasswordStrengthText()}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getPasswordStrengthColor()} transition-all duration-300`}
                      style={{ width: `${passwordStrength}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {errors.newPassword && (
                <p className="mt-2 text-sm text-destructive flex items-center gap-1">
                  <AlertCircle size={14} />
                  {errors.newPassword}
                </p>
              )}

              <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                <p className="text-xs font-medium text-foreground mb-2">Password must include:</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {requirements.map((req) => (
                    <li
                      key={req.label}
                      className={`flex items-center gap-2 ${req.met ? 'text-success' : ''}`}
                    >
                      <span>{req.met ? '✓' : '○'}</span>
                      {req.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Confirm Password
              </label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="************"
                  aria-invalid={!!errors.confirmPassword}
                  className="h-10 pr-9"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isSubmitting}
                  aria-label={showConfirmPassword ? 'Hide confirmation entry' : 'Show confirmation entry'}
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-sm text-destructive flex items-center gap-1">
                  <AlertCircle size={14} />
                  {errors.confirmPassword}
                </p>
              )}
              {formData.newPassword &&
                formData.confirmPassword &&
                formData.newPassword === formData.confirmPassword && (
                  <p className="mt-1 text-sm text-success flex items-center gap-1">
                    <CheckCircle size={14} />
                    Passwords match!
                  </p>
                )}
            </div>

            <Button type="submit" disabled={isSubmitting} className="w-full h-10 gap-2">
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Resetting Password...
                </>
              ) : (
                <>
                  <Lock size={16} />
                  Reset Password
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-center text-sm text-muted-foreground">
              Need help? Contact your administrator or check your email for further instructions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
