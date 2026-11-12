import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import ReasonHint from './ReasonHint';

type Props = {
  mode: 'suspend' | 'restore';
  agencyName: string;
  slug: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
};

/** Suspending needs a reason and the agency's short name typed back, so it can't happen by a stray click. */
export default function StatusChangeDialog({ mode, agencyName, slug, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const suspending = mode === 'suspend';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal?.();
  }, []);

  const ready = reason.trim().length >= 5 && (!suspending || typed.trim() === slug);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      aria-labelledby="status-dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40">
      <form onSubmit={submit} className="space-y-4 p-6">
        <div>
          <h2 id="status-dialog-title" className="font-heading text-lg font-semibold">
            {suspending ? `Suspend ${agencyName}?` : `Restore ${agencyName}?`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {suspending
              ? 'Everyone in this agency is signed out within a few minutes and cannot sign in until it is restored. Their data is kept.'
              : 'Staff can sign in again straight away.'}
          </p>
        </div>

        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="text-sm">
          <label htmlFor="status-reason" className="mb-1.5 block font-medium">Reason</label>
          <textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} required
            aria-describedby="status-reason-hint" placeholder={suspending ? 'e.g. Unpaid for 60 days' : 'e.g. Payment received'}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
          <ReasonHint id="status-reason-hint" reason={reason} note="Recorded in the agency's history." />
        </div>

        {suspending && (
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">
              Type <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{slug}</code> to confirm
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className="h-9 font-mono" />
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant={suspending ? 'destructive' : 'default'} disabled={!ready || busy}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {suspending ? 'Suspend agency' : 'Restore agency'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
