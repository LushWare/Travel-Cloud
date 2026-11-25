import { fetchBusinessSignals } from './analyticsClient.js';
import { generateRecommendations } from './ai/generateRecommendations.js';
import { buildRecommendations } from './recommendationEngine.js';
import prisma from './db/client.js';

const priorityRank = { high: 0, medium: 1, low: 2 };
const REFRESH_WINDOW_MS = 5 * 60_000;
export const FAILURE_COOLDOWN_MS = 2 * 60_000;
export const RECURRENCE_GAP_MS = 24 * 60 * 60_000;
const CACHE_VERSION = 10;
const inFlightRefreshes = new Map();
const recentFailures = new Map();

function baseScopeKey(actor) {
  return actor.role === 'salesRep' ? `rep:${actor.id}` : 'agency';
}

function storageScopeKey(scopeKey, mode) {
  return `v${CACHE_VERSION}:${scopeKey}:${mode}`;
}

export function resetRefreshStateForTests() {
  inFlightRefreshes.clear();
  recentFailures.clear();
}

export async function refreshRecommendations(actor, requestId, mode = 'ai') {
  const viewerScopeKey = baseScopeKey(actor);
  const scopeKey = storageScopeKey(viewerScopeKey, mode);
  const cachedRun = await prisma.recommendationRun.findUnique({ where: { scopeKey } });
  if (cachedRun && Date.now() - cachedRun.lastRunAt.getTime() < REFRESH_WINDOW_MS) {
    return { scopeKey, sourceAsOf: cachedRun.sourceAsOf?.toISOString() ?? null };
  }

  const failure = recentFailures.get(scopeKey);
  if (failure && Date.now() - failure.at < FAILURE_COOLDOWN_MS) throw failure.error;
  if (inFlightRefreshes.has(scopeKey)) return inFlightRefreshes.get(scopeKey);
  const refresh = runRefresh(actor, requestId, mode, viewerScopeKey, scopeKey)
    .then((result) => {
      recentFailures.delete(scopeKey);
      return result;
    }, (error) => {
      recentFailures.set(scopeKey, { at: Date.now(), error });
      throw error;
    })
    .finally(() => inFlightRefreshes.delete(scopeKey));
  inFlightRefreshes.set(scopeKey, refresh);
  return refresh;
}

async function runRefresh(actor, requestId, mode, viewerScopeKey, scopeKey) {
  const source = await fetchBusinessSignals(actor, requestId);
  if ((source.scope === 'own') !== viewerScopeKey.startsWith('rep:')) throw new Error('Analytics signal scope did not match the requesting actor');
  const candidates = mode === 'ai'
    ? await generateRecommendations(source)
    : buildRecommendations(source.signals);
  const keys = candidates.map((item) => item.key);

  await prisma.$transaction(async (tx) => {
    // Both modes replace the whole snapshot: anything not in this run is no
    // longer a current finding and must stop showing.
    await tx.recommendation.updateMany({
      where: { scopeKey, active: true, ...(keys.length ? { key: { notIn: keys } } : {}) },
      data: { active: false },
    });

    if (keys.length) {
      const recurring = await tx.recommendation.findMany({
        where: {
          scopeKey,
          key: { in: keys },
          active: false,
          updatedAt: { lt: new Date(Date.now() - RECURRENCE_GAP_MS) },
        },
        select: { id: true },
      });
      if (recurring.length) {
        await tx.recommendationFeedback.deleteMany({
          where: { recommendationId: { in: recurring.map(({ id }) => id) } },
        });
      }
    }

    for (const item of candidates) {
      const data = {
        module: item.module,
        category: item.category,
        priority: item.priority,
        title: item.title,
        summary: item.summary,
        aiExplanation: item.aiExplanation || null,
        evidence: item.evidence,
        relatedRecordIds: item.relatedRecordIds,
        action: item.action,
        sourceAsOf: new Date(source.asOf),
        active: true,
      };
      await tx.recommendation.upsert({
        where: { scopeKey_key: { scopeKey, key: item.key } },
        create: { scopeKey, key: item.key, ...data },
        update: data,
      });
    }
    await tx.recommendationRun.upsert({
      where: { scopeKey },
      create: { scopeKey, sourceAsOf: new Date(source.asOf), lastRunAt: new Date() },
      update: { sourceAsOf: new Date(source.asOf), lastRunAt: new Date() },
    });
  });

  return { scopeKey, sourceAsOf: source.asOf };
}

export async function listRecommendations({ actor, module, status = 'active', requestId, mode = 'ai' }) {
  const { scopeKey, sourceAsOf } = await refreshRecommendations(actor, requestId, mode);
  const rows = await prisma.recommendation.findMany({
    where: {
      scopeKey,
      active: true,
      ...(module && module !== 'dashboard' ? { module } : {}),
    },
    include: { feedback: { where: { actorId: actor.id }, take: 1 } },
  });

  rows.sort((left, right) => (priorityRank[left.priority] ?? 3) - (priorityRank[right.priority] ?? 3));
  const allRecommendations = rows.map(({ feedback, ...item }) => ({
    ...item,
    relatedRecordIds: Array.isArray(item.relatedRecordIds) ? item.relatedRecordIds : [],
    evidence: Array.isArray(item.evidence) ? item.evidence : [],
    action: item.action,
    viewerStatus: feedback[0]?.status ?? 'new',
  }));
  const counts = {
    active: allRecommendations.filter(({ viewerStatus }) => !['reviewed', 'completed', 'dismissed'].includes(viewerStatus)).length,
    reviewed: allRecommendations.filter(({ viewerStatus }) => viewerStatus === 'reviewed').length,
  };
  const recommendations = allRecommendations.filter(({ viewerStatus }) => {
    if (status === 'active') return !['reviewed', 'completed', 'dismissed'].includes(viewerStatus);
    if (status === 'reviewed') return viewerStatus === 'reviewed';
    if (status === 'dismissed' || status === 'completed') return viewerStatus === status;
    return true;
  });

  return {
    scope: baseScopeKey(actor) === 'agency' ? 'agency' : 'own',
    mode,
    sourceAsOf,
    counts,
    recommendations,
  };
}

export async function saveRecommendationFeedback({ actor, recommendationId, status, reason }) {
  const viewerScopeKey = baseScopeKey(actor);
  const recommendation = await prisma.recommendation.findFirst({
    where: {
      id: recommendationId,
      active: true,
      scopeKey: { in: [storageScopeKey(viewerScopeKey, 'ai'), storageScopeKey(viewerScopeKey, 'rules')] },
    },
    select: { id: true },
  });
  if (!recommendation) return false;

  await prisma.recommendationFeedback.upsert({
    where: { recommendationId_actorId: { recommendationId, actorId: actor.id } },
    create: { recommendationId, actorId: actor.id, status, reason: reason || null },
    update: { status, reason: reason || null },
  });
  return true;
}