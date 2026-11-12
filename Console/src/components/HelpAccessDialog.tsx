import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { agencyApi, helpAccessUrl } from '../lib/api';
import { Button } from './ui/button';
import ReasonHint from './ReasonHint';

type Props = { agencyId: string; agencyName: string; onStarted: (minutes: number) => void; onClose: () => void };

/**
 * Opens Management as this agency, view-only, for 15 or 30 minutes. The new tab is opened straight
 * from the click (so browsers don't block it) and pointed at the one-time link once the server
 * has recorded the reason.
 */
export default function HelpAccessDialog({ agencyId, agencyName, onStarted, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState<15 | 30>(30);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return;
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    setBusy(true);
    setError('');
    try {
      const { code } = await agencyApi.startHelp(agencyId, reason.trim(), minutes);
      const url = helpAccessUrl(code);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener');
      onStarted(minutes);
    } catch (err) {
      tab?.close();
      setError((err as Error).message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      aria-labelledby="help-dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40">
      <form onSubmit={submit} className="space-y-4 p-6">
        <div>
          <h2 id="help-dialog-title" className="font-heading text-lg font-semibold">Help {agencyName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Opens Management as this agency in a new tab. You can look at everything but change nothing.
            The agency sees this, with your reason, in its audit log.
          </p>
        </div>

        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="text-sm">
          <label htmlFor="help-reason" className="mb-1.5 block font-medium">Reason</label>
          <textarea id="help-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} required
            aria-describedby="help-reason-hint" placeholder="e.g. Owner reported the invoice PDF shows the wrong bank details"
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
          <ReasonHint id="help-reason-hint" reason={reason} />
        </div>

        <fieldset className="text-sm">
          <legend className="mb-1.5 font-medium">How long</legend>
          <div className="flex gap-2">
            {([15, 30] as const).map((m) => (
              <label key={m} className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 ${minutes === m ? 'border-primary bg-accent' : 'border-input'}`}>
                <input type="radio" name="minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} className="accent-primary" />
                {m} minutes
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || reason.trim().length < 5}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Eye aria-hidden="true" />}
            Open view-only
          </Button>
        </div>
      </form>
    </dialog>
  );
}
