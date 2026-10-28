import { useEffect, useState, useCallback } from 'react';
import {
  Phone, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  Sparkles, Loader2, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { voiceAPI, leadAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import AiChangeApprovalCard from './AiChangeApprovalCard';
import type { PendingAiChange } from './AiChangeApprovalCard';
import RelatedLeadsCard from './RelatedLeadsCard';
import type { RelatedLead } from './RelatedLeadsCard';

interface PendingChangeEntry {
  selectionId: string;
  packageName: string | null;
  change: PendingAiChange;
}

interface TranscriptTurn {
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
}

interface CallAction {
  sequence: number;
  functionName: string;
  succeeded: boolean;
  createdAt: string;
}

interface VoiceCall {
  id: string;
  startedAt: string;
  durationSec: number | null;
  disposition: string;
  matchOutcome: string;
  needsRepFollowup: boolean;
  summary: string | null;
  sentiment: string | null;
  transcript: TranscriptTurn[];
  hasRecording: boolean;
  actions: CallAction[];
}

interface LeadAiCallsTabProps {
  lead: any;
  onVerified?: () => void;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function formatCallTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** "AI attached Maldives 5N package" reads better than "attach_package". */
export function describeAction(functionName: string) {
  return functionName.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export default function LeadAiCallsTab({ lead, onVerified }: LeadAiCallsTabProps) {
  const leadId = (lead?._id || lead?.id)?.toString();
  const [calls, setCalls] = useState<VoiceCall[]>([]);
  const [pending, setPending] = useState<PendingChangeEntry[]>([]);
  const [related, setRelated] = useState<RelatedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [verifying, setVerifying] = useState(false);
  // Deliberately separate from `error`, which gates the whole render: a failed
  // "Mark as checked" must not blank the call history the rep came here to read,
  // so this one reports inline under the header instead.
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // A lead with no id can never have calls, but `loading` starts true and is
    // only cleared in the `finally` below — bailing out before that would leave
    // the spinner up forever, with no error and no way to retry.
    if (!leadId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Call history, any unreviewed AI edit, and the caller's other leads are
      // independent — a failure to load one must not blank out the call history
      // the rep came here to read, so all three settle separately.
      const [callsResult, selectionsResult, relatedResult] = await Promise.allSettled([
        voiceAPI.getCallsForLead(leadId),
        leadAPI.getPackageSelections(leadId),
        leadAPI.getRelatedLeads(leadId),
      ]);

      if (callsResult.status === 'fulfilled') setCalls(callsResult.value?.data ?? []);
      else setError('Could not load call history.');

      if (selectionsResult.status === 'fulfilled') {
        const selections = selectionsResult.value?.data ?? [];
        setPending(
          selections
            .filter((s: any) => s?.pendingAiChange)
            .map((s: any) => ({ selectionId: s.id, packageName: s.packageName, change: s.pendingAiChange }))
        );
      } else {
        setPending([]);
      }

      if (relatedResult.status === 'fulfilled') setRelated(relatedResult.value?.data?.related ?? []);
      else setRelated([]);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      await leadAPI.verifyAiLead(leadId);
      onVerified?.();
    } catch {
      setVerifyError('Could not mark this lead as verified.');
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading call history…</span>
      </div>
    );
  }

  // An unreviewed AI edit is the most actionable thing on this tab, so it
  // renders above everything and in every branch below — a rep must still see
  // it when the call history is empty or failed to load.
  const pendingBlock = pending.length > 0 && (
    <div className="space-y-3">
      {pending.map((p) => (
        <AiChangeApprovalCard
          key={p.selectionId}
          leadId={leadId}
          selectionId={p.selectionId}
          packageName={p.packageName}
          change={p.change}
          onResolved={() => { load(); onVerified?.(); }}
        />
      ))}
    </div>
  );

  // The caller's other leads are context for every branch: a rep looking at an
  // empty call list still needs to know this number has phoned four times
  // before under a different lead.
  const historyBlock = <RelatedLeadsCard related={related} />;

  if (error) {
    return (
      <div className="space-y-4">
        {pendingBlock}
        {historyBlock}
        <div className="py-16 text-center space-y-3">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Try again</Button>
        </div>
      </div>
    );
  }

  if (!calls.length) {
    return (
      <div className="space-y-4">
        {pendingBlock}
        {historyBlock}
        <div className="py-16 text-center text-muted-foreground space-y-2">
          <Phone className="w-8 h-8 mx-auto opacity-40" />
          <p className="font-medium">No AI calls on this lead</p>
          <p className="text-sm">Calls handled by the voice agent will appear here.</p>
        </div>
      </div>
    );
  }

  const verified = Boolean(lead?.aiVerifiedAt);
  const packageReview = Boolean(lead?.voiceNeedsRepReview);
  const needsCheck = packageReview || calls.some((c) => c.needsRepFollowup) || Boolean(lead?.needsRepFollowup);

  return (
    <div className="space-y-4">
      {pendingBlock}
      {historyBlock}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span className="font-semibold">{calls.length} {calls.length === 1 ? 'call' : 'calls'}</span>
          {packageReview && (
            <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300" role="alert">
              <AlertTriangle className="w-4 h-4" /> Package/price change needs review
            </span>
          )}
          {needsCheck && !packageReview && (
            <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300" role="alert">
              <AlertTriangle className="w-4 h-4" /> Needs Rep Attention
            </span>
          )}
          {verified && !needsCheck && (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4" /> Verified
            </span>
          )}
        </div>
        {!verified && (
          <Button size="sm" onClick={handleVerify} disabled={verifying}>
            {verifying ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
            Mark as checked
          </Button>
        )}
      </div>

      {verifyError && (
        <p role="alert" className="text-sm text-destructive">{verifyError}</p>
      )}

      {calls.map((call, idx) => {
        const isOpen = expanded[call.id];
        const callNumber = calls.length - idx;

        return (
          <div key={call.id} className="rounded-lg border border-border overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 bg-card p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>Call {callNumber}</span>
                  <span className="text-muted-foreground font-normal">{formatCallTime(call.startedAt)}</span>
                  <span className="text-muted-foreground font-normal">· {formatDuration(call.durationSec)}</span>
                  {call.needsRepFollowup && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      <AlertTriangle className="w-3 h-3" /> Needs Rep Attention
                    </span>
                  )}
                  {call.matchOutcome === 'AMBIGUOUS' && (
                    <span
                      title="Several leads share this phone number — confirm this call belongs to this lead"
                      className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
                    >
                      <Users className="w-3 h-3" /> Shared number
                    </span>
                  )}
                </div>
                {call.summary && <p className="text-sm text-muted-foreground">{call.summary}</p>}
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((p) => ({ ...p, [call.id]: !p[call.id] }))}
                aria-expanded={Boolean(isOpen)}
              >
                {isOpen ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
                {isOpen ? 'Hide' : 'Details'}
              </Button>
            </div>

            {isOpen && (
              <div className="space-y-4 border-t border-border bg-muted/30 p-3">
                {call.hasRecording && (
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase text-muted-foreground">Recording</p>
                    <audio controls preload="none" className="w-full" src={voiceAPI.recordingUrl(call.id)}>
                      Your browser does not support audio playback.
                    </audio>
                  </div>
                )}

                {call.actions.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-bold uppercase text-muted-foreground">What the AI did</p>
                    <ul className="space-y-1">
                      {call.actions.map((a) => (
                        <li key={a.sequence} className="flex items-center gap-2 text-sm">
                          <Sparkles className={cn('w-3 h-3 shrink-0', a.succeeded ? 'text-purple-500' : 'text-destructive')} />
                          <span>{describeAction(a.functionName)}</span>
                          <span className="text-muted-foreground">— {formatCallTime(a.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <p className="mb-1 text-xs font-bold uppercase text-muted-foreground">Transcript</p>
                  {call.transcript.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No transcript captured for this call.</p>
                  ) : (
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {call.transcript.map((turn) => (
                        <div
                          key={turn.sequence}
                          className={cn(
                            'rounded-lg px-3 py-2 text-sm',
                            turn.role === 'assistant'
                              ? 'bg-purple-50 dark:bg-purple-500/10'
                              : 'bg-card border border-border'
                          )}
                        >
                          <span className="mb-0.5 block text-[11px] font-bold uppercase text-muted-foreground">
                            {turn.role === 'assistant' ? 'AI agent' : 'Customer'}
                          </span>
                          {turn.content}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
