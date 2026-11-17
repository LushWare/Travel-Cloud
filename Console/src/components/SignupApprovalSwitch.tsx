import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { ApiError, settingsApi } from '../lib/api';

/**
 * "Require approval for new sign-ups". Off: anyone who signs up starts their trial at once.
 * On: new agencies wait as "Awaiting approval" until a platform admin approves them.
 */
export default function SignupApprovalSwitch({ canChange }: { canChange: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    settingsApi.get()
      .then((data) => setEnabled(data.requireSignupApproval))
      .catch(() => setError('Could not load the sign-up setting.'));
  }, []);

  const toggle = async () => {
    if (enabled === null) return;
    const next = !enabled;
    const question = next
      ? 'Require approval for new sign-ups? New agencies will wait until you approve them.'
      : 'Stop requiring approval? New agencies will start their trial straight away. Agencies already waiting stay waiting.';
    if (!window.confirm(question)) return;
    setSaving(true);
    setError('');
    try {
      const data = await settingsApi.setSignupApproval(next);
      setEnabled(data.requireSignupApproval);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the sign-up setting.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3" aria-label="Sign-up approval">
      <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Require approval for new sign-ups</p>
        <p className="text-xs text-muted-foreground">
          {enabled ? 'On: new agencies wait as "Awaiting approval" until you approve them.' : 'Off: new agencies start their 14-day trial straight away.'}
        </p>
        {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {enabled === null && !error ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading sign-up setting" />
      ) : (
        <div className="flex items-center gap-2">
        <button type="button" role="switch" aria-checked={Boolean(enabled)} aria-label="Require approval for new sign-ups"
          onClick={toggle} disabled={!canChange || saving || enabled === null}
          title={canChange ? undefined : 'Only platform admins can change this.'}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 ${enabled ? 'border-primary bg-primary' : 'border-muted-foreground/60 bg-input'}`}>
          <span className={`inline-block h-4 w-4 rounded-full shadow transition-transform ${enabled ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0.5 bg-muted-foreground'}`} />
        </button>
        <span className="w-8 text-xs font-medium text-muted-foreground" aria-hidden="true">{enabled ? 'On' : 'Off'}</span>
        </div>
      )}
    </section>
  );
}
