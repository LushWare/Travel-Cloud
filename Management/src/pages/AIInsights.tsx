import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, Lightbulb, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchRecommendations, updateRecommendation, type BusinessRecommendation } from '@/services/recommendationsAPI';
import { RecommendationDetailDialog } from '@/features/recommendations/RecommendationStrip';
import { formatEvidenceValue } from '@/features/recommendations/formatEvidenceValue';
import RecommendationModeSwitch from '@/features/recommendations/RecommendationModeSwitch';
import type { RecommendationMode } from '@/features/recommendations/recommendationMode';

const categories = ['all', 'sales', 'finance', 'packages', 'operations', 'performance'];

export default function AIInsights() {
  const [items, setItems] = useState<BusinessRecommendation[]>([]);
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<BusinessRecommendation | null>(null);
  const [mode, setMode] = useState<RecommendationMode>('ai');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchRecommendations({ status, mode, signal: controller.signal })
      .then((response) => setItems(response.recommendations))
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'AI Insights could not be loaded.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [status, mode, refreshKey]);

  const filtered = useMemo(() => category === 'all' ? items : items.filter((item) => item.category === category), [category, items]);
  const highPriority = items.filter((item) => item.priority === 'high').length;

  const updateStatus = async (id: string, nextStatus: 'reviewed' | 'completed' | 'dismissed') => {
    await updateRecommendation(id, nextStatus);
    if (nextStatus === 'dismissed' || nextStatus === 'completed') setItems((current) => current.filter((entry) => entry.id !== id));
    else setItems((current) => current.map((entry) => entry.id === id ? { ...entry, viewerStatus: nextStatus } : entry));
  };

  const changeMode = (nextMode: RecommendationMode) => {
    setMode(nextMode);
  };

  const refreshInsights = () => {
    setMode('ai');
    setRefreshKey((value) => value + 1);
  };

  return (
    <div className="min-h-full bg-background">
      <PageHeader title="AI Insights" subtitle={mode === 'ai' ? 'AI recommendations based on current and historical business analytics' : 'Rule-based recommendations from current business signals'} actions={<Button variant="outline" size="icon" onClick={refreshInsights} aria-label="Refresh insights"><RefreshCw className="h-4 w-4" /></Button>} />
      <main className="space-y-5 p-4 sm:p-6 lg:p-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-md border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Active recommendations</p><p className="mt-1 font-mono text-2xl tabular-nums">{items.length}</p></div>
          <div className="rounded-md border border-border bg-card p-4"><p className="text-xs text-muted-foreground">High priority</p><p className="mt-1 font-mono text-2xl tabular-nums text-destructive">{highPriority}</p></div>
          <div className="rounded-md border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Sales & finance</p><p className="mt-1 font-mono text-2xl tabular-nums">{items.filter((item) => ['sales', 'finance'].includes(item.category)).length}</p></div>
          <div className="rounded-md border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Operations & performance</p><p className="mt-1 font-mono text-2xl tabular-nums">{items.filter((item) => ['operations', 'performance'].includes(item.category)).length}</p></div>
        </div>

        <section aria-label="Recommendations" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary" /><h2 className="text-base font-semibold">Agency recommendations</h2></div>
            <div className="flex flex-wrap items-center gap-2">
              <RecommendationModeSwitch mode={mode} onChange={changeMode} />
              <label className="sr-only" htmlFor="recommendation-category">Category</label>
              <select id="recommendation-category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                {categories.map((value) => <option key={value} value={value}>{value === 'all' ? 'All categories' : value[0].toUpperCase() + value.slice(1)}</option>)}
              </select>
              <label className="sr-only" htmlFor="recommendation-status">Status</label>
              <select id="recommendation-status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="active">Active</option><option value="reviewed">Reviewed</option><option value="completed">Completed</option><option value="dismissed">Dismissed</option><option value="all">All active</option>
              </select>
            </div>
          </div>

          {loading ? <p className="py-6 text-sm text-muted-foreground">Analyzing current business data…</p> : error ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 p-4 text-sm"><span className="flex items-center gap-2 text-muted-foreground"><AlertCircle className="h-4 w-4" />{error}</span><Button variant="outline" size="sm" onClick={() => setRefreshKey((value) => value + 1)}>Retry</Button></div>
          ) : filtered.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-10 text-center"><p className="text-sm font-medium">No matching recommendations</p><p className="mt-1 text-sm text-muted-foreground">The current agency data has no findings in this view.</p></div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item)}
                  aria-label={`View ${item.title} details`}
                  className="group flex min-h-40 min-w-0 cursor-pointer flex-col rounded-md border border-border bg-card p-3 text-left transition-[transform,border-color,background-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-muted/50 hover:shadow-sm active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <div className="mb-2 flex w-full flex-wrap items-center gap-2">
                    <Badge variant={item.priority === 'high' ? 'destructive' : item.priority === 'medium' ? 'outline' : 'secondary'} className={item.priority === 'medium' ? 'border-warning/50 text-warning' : ''}>{item.priority}</Badge>
                    <Badge variant="outline" className="capitalize">{item.module}</Badge>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{item.title}</span>
                  <span className="mt-1 line-clamp-3 text-sm text-muted-foreground">{item.summary}</span>
                  {item.evidence.length > 0 && (
                    <span className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {item.evidence.slice(0, 2).map((fact) => `${fact.label}: ${formatEvidenceValue(fact.value)}`).join(' · ')}
                    </span>
                  )}
                  <span className="mt-auto flex items-center gap-1 pt-3 text-xs font-semibold text-primary">
                    View details <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
        <RecommendationDetailDialog item={selected} onClose={() => setSelected(null)} onUpdate={updateStatus} />
      </main>
    </div>
  );
}
