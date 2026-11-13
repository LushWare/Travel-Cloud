import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Mail, PlugZap, Trash2 } from 'lucide-react';
import toast from '@/lib/toast';
import { integrationAPI } from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type EmailStatus = {
  connected: boolean;
  status?: string;
  config?: { host: string; port: number; secure: boolean; from: string; replyTo?: string | null };
  fingerprint?: string | null;
  lastFour?: string | null;
  lastTestedAt?: string | null;
  lastError?: string | null;
};

const EMPTY_FORM = {
  host: '',
  port: '587',
  secure: false,
  username: '',
  password: '',
  from: '',
  replyTo: '',
};

export default function EmailIntegrationSettings() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await integrationAPI.getEmail();
    const next = response.data as EmailStatus;
    setStatus(next);
    const config = next.config;
    if (config) {
      setForm((current) => ({
        ...current,
        host: config.host,
        port: String(config.port),
        secure: config.secure,
        from: config.from,
        replyTo: config.replyTo || '',
      }));
    }
  }, []);

  useEffect(() => {
    loadStatus()
      .catch((error) => toast.error(error?.message || 'Could not load email settings'))
      .finally(() => setLoading(false));
  }, [loadStatus]);

  const setField = (field: keyof typeof EMPTY_FORM, value: string | boolean) =>
    setForm((current) => ({ ...current, [field]: value }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await integrationAPI.saveEmail({
        ...form,
        port: Number(form.port),
        replyTo: form.replyTo || undefined,
      });
      setStatus(response.data as EmailStatus);
      setForm((current) => ({ ...current, username: '', password: '' }));
      toast.success('Email connection verified and saved');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not save email settings');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      await integrationAPI.testEmail();
      await loadStatus();
      toast.success('Email connection is working');
    } catch (error) {
      toast.error((error as Error)?.message || 'Email connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await integrationAPI.disconnectEmail();
      setStatus({ connected: false });
      setForm(EMPTY_FORM);
      toast.success('Agency email disconnected');
    } catch (error) {
      toast.error((error as Error)?.message || 'Could not disconnect email');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card" aria-labelledby="agency-email-heading">
      <div className="border-b border-border p-5">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h2 id="agency-email-heading" className="font-semibold text-foreground">Agency email</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Send quotations and invoices through your agency&apos;s SMTP account.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading email connection" />
        ) : (
          <>
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              {status?.connected
                ? `Connected: ${status.config?.from} via ${status.config?.host}. Your credentials are encrypted and never shown here.`
                : status?.status === 'error'
                  ? 'The saved SMTP connection needs attention. Replace the settings and verify the connection to resume sending.'
                  : 'Until you connect an account, email continues to use the platform sender.'}
            </div>

            <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">SMTP server</span>
                <Input required autoComplete="url" value={form.host} onChange={(e) => setField('host', e.target.value)} placeholder="smtp.example.com" />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Port</span>
                <Input required type="number" min="1" max="65535" value={form.port} onChange={(e) => setField('port', e.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">SMTP username</span>
                <Input required autoComplete="off" value={form.username} onChange={(e) => setField('username', e.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">SMTP password or app password</span>
                <Input required type="password" autoComplete="new-password" value={form.password} onChange={(e) => setField('password', e.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Sender address</span>
                <Input required type="email" autoComplete="email" value={form.from} onChange={(e) => setField('from', e.target.value)} placeholder="sales@youragency.com" />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">Reply-to address (optional)</span>
                <Input type="email" autoComplete="email" value={form.replyTo} onChange={(e) => setField('replyTo', e.target.value)} />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.secure}
                  onChange={(e) => setField('secure', e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Use direct TLS (port 465); leave unchecked for STARTTLS (usually port 587)
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  {saving ? 'Checking and saving…' : status?.connected ? 'Replace email connection' : 'Test and connect'}
                </Button>
                {status?.connected && (
                  <>
                    <Button type="button" variant="outline" onClick={test} disabled={testing || saving}>
                      {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Test saved connection
                    </Button>
                    <Button type="button" variant="outline" onClick={disconnect} disabled={disconnecting || saving} className="text-destructive">
                      {disconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      Disconnect
                    </Button>
                  </>
                )}
              </div>
            </form>

            {status?.lastTestedAt && (
              <p className="text-xs text-muted-foreground">
                Last tested {new Date(status.lastTestedAt).toLocaleString()}
                {status.lastError ? ` · ${status.lastError}` : ''}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
