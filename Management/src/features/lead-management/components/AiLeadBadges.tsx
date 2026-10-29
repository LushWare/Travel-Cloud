import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AiLeadFlags {
  aiHandled?: boolean;
  needsRepFollowup?: boolean;
  voiceNeedsRepReview?: boolean;
  voiceReviewReason?: string | null;
  aiVerifiedAt?: string | null;
}

export function isAiHandled(lead: AiLeadFlags | null | undefined) {
  return Boolean(lead?.aiHandled);
}

export function needsRepCheck(lead: AiLeadFlags | null | undefined) {
  return Boolean(lead?.needsRepFollowup || lead?.voiceNeedsRepReview);
}

export function isAiVerified(lead: AiLeadFlags | null | undefined) {
  return Boolean(lead?.aiHandled && lead?.aiVerifiedAt);
}

interface AiLeadBadgesProps {
  lead: AiLeadFlags | null | undefined;
  className?: string;
  /** Icon-only, for dense table rows. */
  compact?: boolean;
}

/**
 * Badges marking what the voice agent touched. Rendered wherever a lead is
 * listed so a rep can see AI involvement without opening the lead.
 */
export function AiLeadBadges({ lead, className, compact = false }: AiLeadBadgesProps) {
  if (!isAiHandled(lead)) return null;

  const verified = isAiVerified(lead);
  const needsCheck = needsRepCheck(lead);
  const packageReview = Boolean(lead?.voiceNeedsRepReview);

  return (
    <span className={cn('inline-flex items-center gap-1 align-middle', className)}>
      <Badge
        icon={Sparkles}
        label="AI"
        title="Created or updated by the voice agent"
        compact={compact}
        tone="bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
      />
      {packageReview && (
        <Badge
          icon={AlertTriangle}
          label="Rep review"
          title={lead?.voiceReviewReason === 'package_changed_requires_repricing'
            ? 'Package or price changed; review before proceeding'
            : 'The voice booking requires rep review'}
          compact={compact}
          tone="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
        />
      )}
      {needsCheck && !packageReview && (
        <Badge
          icon={AlertTriangle}
          label="Needs Rep Attention"
          title="The voice agent could not resolve something, or made changes awaiting approval"
          compact={compact}
          tone="bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
        />
      )}
      {verified && !needsCheck && (
        <Badge
          icon={CheckCircle2}
          label="Verified"
          title="A rep has reviewed what the voice agent recorded"
          compact={compact}
          tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        />
      )}
    </span>
  );
}

interface BadgeProps {
  icon: typeof Sparkles;
  label: string;
  title: string;
  tone: string;
  compact: boolean;
}

function Badge({ icon: Icon, label, title, tone, compact }: BadgeProps) {
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
        tone,
        compact ? 'p-1' : 'px-2 py-0.5 text-[11px]'
      )}
    >
      <Icon className="w-3 h-3 shrink-0" aria-hidden />
      {!compact && <span>{label}</span>}
    </span>
  );
}

export default AiLeadBadges;
