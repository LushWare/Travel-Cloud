import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronDown, ChevronUp, Lightbulb, RefreshCw } from 'lucide-react';
import toast from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  fetchRecommendations,
  updateRecommendation,
  type BusinessRecommendation,
} from '@/services/recommendationsAPI';
import RecommendationModeSwitch from './RecommendationModeSwitch';
import type { RecommendationMode } from './recommendationMode';
import { formatEvidenceValue } from './formatEvidenceValue';

const MODULE_PATHS: Record<string, string> = {
  dashboard: '/',
  leads: '/leads',
  packages: '/packages',
  flights: '/flights',
  hotels: '/hotels',
  billing: '/billing',
  analytics: '/analytics',
  users: '/users',
  career: '/career',
};

const priorityVariant: Record<string, 'destructive' | 'outline' | 'secondary'> = {
  high: 'destructive',
  medium: 'outline',
  low: 'secondary',
};

const INITIAL_RECOMMENDATION_COUNT = 4;

function destinationFor(item: BusinessRecommendation) {
  const module = item.action?.module || item.module;
  const path = MODULE_PATHS[module] || '/ai-insights';
  const params = new URLSearchParams();
  const tab = item.action?.tab || (['flights', 'hotels'].includes(module) ? 'bookings' : module === 'users' ? 'website-users' : undefined);
  const canFilterRecords = ['leads', 'packages', 'users'].includes(module) || Boolean(item.action?.tab) || ['flights', 'hotels'].includes(module);

  if (tab) params.set('tab', tab);
  if (canFilterRecords && item.relatedRecordIds.length > 0) {
    params.set('ids', item.relatedRecordIds.join(','));
    params.set('focus', 'recommendation');
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function RecommendationDetailDialog({
  item,
  onClose,
  onUpdate,
}: {
  item: BusinessRecommendation | null;
  onClose: () => void;
  onUpdate: (id: string, status: 'reviewed' | 'completed' | 'dismissed') => Promise<void>;
}) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSaving(false);
    setError('');
  }, [item?.id]);

  if (!item) return null;

  const update = async (status: 'reviewed' | 'completed' | 'dismissed') => {
    setSaving(true);
    setError('');
    try {
      await onUpdate(item.id, status);
      toast.success({
        reviewed: 'Recommendation marked as reviewed',
        completed: 'Recommendation marked as complete',
        dismissed: 'Recommendation dismissed',
      }[status]);
      onClose();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update this recommendation.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant={priorityVariant[item.priority] || 'secondary'} className={item.priority === 'medium' ? 'border-warning/50 text-warning' : ''}>{item.priority} priority</Badge>
            <span className="text-xs capitalize text-muted-foreground">{item.module}</span>
          </div>
          <DialogTitle className="pr-7">{item.title}</DialogTitle>
          <DialogDescription>{item.summary}</DialogDescription>
        </DialogHeader>

        {item.evidence.length > 0 && (
          <dl className="grid grid-cols-1 gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">
            {item.evidence.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                <dd className="break-words text-sm font-medium text-foreground">{formatEvidenceValue(fact.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {item.relatedRecordIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Based on {item.relatedRecordIds.length} linked CRM record{item.relatedRecordIds.length === 1 ? '' : 's'}.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void update('reviewed')} disabled={saving}>Mark reviewed</Button>
            <Button variant="outline" onClick={() => void update('completed')} disabled={saving}>Mark complete</Button>
            <Button variant="ghost" onClick={() => void update('dismissed')} disabled={saving}>Dismiss</Button>
          </div>
          <Button onClick={() => { onClose(); navigate(destinationFor(item)); }}>
            {item.action?.label || 'Review records'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RecommendationStrip({ module }: { module: string }) {
  const [items, setItems] = useState<BusinessRecommendation[]>([]);
  const [counts, setCounts] = useState({ active: 0, reviewed: 0 });
  const [selected, setSelected] = useState<BusinessRecommendation | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<RecommendationMode>('ai');
  const [statusFilter, setStatusFilter] = useState<'active' | 'reviewed'>('active');
  const visibleItems = useMemo(
    () => expanded ? items : items.slice(0, INITIAL_RECOMMENDATION_COUNT),
    [expanded, items],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchRecommendations({ module, mode, status: statusFilter, signal: controller.signal })
      .then((response) => {
        setItems(response.recommendations);
        setCounts(response.counts);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Recommendations could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [module, mode, refreshKey, statusFilter]);

  const changeMode = (nextMode: RecommendationMode) => {
    setMode(nextMode);
  };

  const retryRecommendations = () => {
    setMode('ai');
    setRefreshKey((value) => value + 1);
  };

  const handleUpdate = async (id: string, status: 'reviewed' | 'completed' | 'dismissed') => {
    await updateRecommendation(id, status);
    const item = items.find((recommendation) => recommendation.id === id);
    if (!item) return;

    const from = item.viewerStatus === 'reviewed' ? 'reviewed' : 'active';
    const movesToReviewed = status === 'reviewed' && from === 'active';
    if (status !== 'reviewed' || statusFilter === 'active') setItems((current) => current.filter((recommendation) => recommendation.id !== id));
    else setItems((current) => current.map((recommendation) => recommendation.id === id ? { ...recommendation, viewerStatus: status } : recommendation));

    if (status !== 'reviewed' || movesToReviewed) {
      setCounts((current) => ({
        ...current,
        [from]: Math.max(0, current[from] - 1),
        ...(movesToReviewed ? { reviewed: current.reviewed + 1 } : {}),
      }));
    }
  };

  return (
    <section aria-label="AI recommendations" className="rounded-md border border-border bg-card px-3 py-3 text-card-foreground sm:px-4">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Lightbulb className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold text-foreground">{mode === 'ai' ? 'AI Recommendations' : 'Rule-based recommendations'}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {items.length > INITIAL_RECOMMENDATION_COUNT && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
              {expanded ? 'Show less' : 'More'}
              {expanded ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
            </Button>
          )}
          {error && <Button variant="ghost" size="icon-sm" onClick={retryRecommendations} aria-label="Retry recommendations"><RefreshCw className="h-4 w-4" /></Button>}
          <RecommendationModeSwitch mode={mode} onChange={changeMode} />
        </div>
      </div>

      <div className="mb-2 flex items-center gap-1" role="group" aria-label="Filter recommendations">
        {(['active', 'reviewed'] as const).map((status) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant={statusFilter === status ? 'secondary' : 'ghost'}
            aria-pressed={statusFilter === status}
            onClick={() => setStatusFilter(status)}
          >
            {status === 'active' ? 'Active' : 'Reviewed'} ({counts[status]})
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="py-2 text-sm text-muted-foreground">Checking current business data…</p>
      ) : error ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><AlertCircle className="h-4 w-4" />{error}</p>
      ) : items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          {statusFilter === 'reviewed' ? 'No reviewed recommendations yet.' : 'No evidence-backed recommendations right now.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className="min-w-0 cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-left text-foreground transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <span className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {item.viewerStatus === 'reviewed' && <Badge variant="outline">Reviewed</Badge>}
                  <Badge variant={priorityVariant[item.priority] || 'secondary'} className={item.priority === 'medium' ? 'border-warning/50 text-warning' : ''}>{item.priority}</Badge>
                </span>
              </span>
              <span className="line-clamp-2 block text-xs text-muted-foreground">{item.summary}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <RecommendationDetailDialog item={selected} onClose={() => setSelected(null)} onUpdate={handleUpdate} />
      )}
    </section>
  );
}