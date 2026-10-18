import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from '@/lib/toast';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';
import BRANDING, { getLoginBranding } from '../config/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Only show test credentials in development when explicitly enabled
const showTestCredentials = import.meta.env.VITE_SHOW_TEST_CREDENTIALS === 'true';

export default function Login() {
  const navigate = useNavigate();
  const { login, loading } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const validateForm = () => {
    if (!formData.email.trim()) {
      toast.error('Email is required');
      return false;
    }

    if (!formData.email.includes('@')) {
      toast.error('Please enter a valid email address');
      return false;
    }

    if (!formData.password) {
      toast.error('Password is required');
      return false;
    }

    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await login(formData.email, formData.password);

      if (result === 'otp-required') {
        navigate('/sales-rep-login-otp');
      } else if (result === 'password-reset-required') {
        navigate('/reset-password');
      } else if (result === true) {
        navigate('/');
      }
    } catch (error) {
      const errorMessage =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Login failed. Please try again.';
      toast.error(errorMessage);
      console.error('Login error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mb-2 flex items-center justify-center gap-3">
            <img src="/logo.jpeg" alt="" className="h-10 w-10 shrink-0 object-contain" />
            <h1 className="font-heading text-xl font-bold text-foreground">
              {getLoginBranding().title}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">{getLoginBranding().subtitle}</p>
        </div>

        {/*
          The page's own surface plus a hairline, not a `bg-card` slab. On the
          light theme that slab was pure white on a near-white page, which is the
          white box this screen should not have. No shadow either: a surface with
          no fill of its own has no elevation to cast.
        */}
        <div className="border border-border rounded-xl p-8">
          <div className="text-center mb-6">
            <h2 className="font-heading text-xl font-semibold text-foreground">Welcome Back</h2>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  className="h-11 pl-9"
                  disabled={isSubmitting || loading}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="********"
                  className="h-11 pl-9 pr-9"
                  disabled={isSubmitting || loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  disabled={isSubmitting || loading}
                  aria-label={showPassword ? 'Hide input' : 'Show input'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || loading}
              className="w-full h-11 gap-2"
            >
              {isSubmitting || loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-center text-xs text-muted-foreground">
              Authorized personnel only. All access is monitored.
            </p>
            <p className="text-center text-sm text-muted-foreground mt-3">
              Sales Rep?{' '}
              <a href="/sales-rep-login" className="text-primary hover:underline font-medium">
                Login with OTP &rarr;
              </a>
            </p>
          </div>
        </div>

        {showTestCredentials && (
          <div className="mt-6 rounded-lg p-4 border border-warning/30 bg-warning/10">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-md bg-warning flex items-center justify-center text-xs text-warning-foreground">
                🔑
              </div>
              <p className="text-sm text-warning font-semibold">
                Development Credentials
              </p>
            </div>
            <div className="grid gap-3 text-xs">
              <div className="p-3 bg-card rounded-lg border border-border">
                <p className="font-semibold text-foreground mb-1">Super Admin</p>
                <p className="text-muted-foreground">
                  Email: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">admin@lushware.com</code>
                </p>
                <p className="text-muted-foreground mt-1">
                  Pass: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">Admin@123456</code>
                </p>
              </div>
              <div className="p-3 bg-card rounded-lg border border-border">
                <p className="font-semibold text-foreground mb-1">Sales Rep</p>
                <p className="text-muted-foreground">
                  Email: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">ravish@gmail.com</code>
                </p>
                <p className="text-muted-foreground mt-1">
                  Pass: <code className="bg-muted px-1.5 py-0.5 rounded text-foreground">Sales@123456</code>
                </p>
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6">
          &copy; {new Date().getFullYear()} {BRANDING.company.name}. All rights reserved.
        </p>
      </div>
    </div>
  );
}
