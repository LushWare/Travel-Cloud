import { fetchBusinessSignals } from './analyticsClient.js';
import { generateRecommendations } from './ai/generateRecommendations.js';
import { buildRecommendations } from './recommendationEngine.js';
import prisma from './db/client.js';

const priorityRank = { high: 0, medium: 1, low: 2 };
const REFRESH_WINDOW_MS = 5 * 60_000;
const CACHE_VERSION = 2;

function baseScopeKey(actor) {
  return actor.role === 'salesRep' && !actor.isSuperAdmin ? `rep:${actor.id}` : 'agency';
}

function storageScopeKey(scopeKey, mode) {
  return `v${CACHE_VERSION}:${scopeKey}:${mode}`;
}

export async function refreshRecommendations(actor, requestId, mode = 'ai') {
  const viewerScopeKey = baseScopeKey(actor);
  const scopeKey = storageScopeKey(viewerScopeKey, mode);
  const cachedRun = await prisma.recommendationRun.findUnique({ where: { scopeKey } });
  if (cachedRun && Date.now() - cachedRun.lastRunAt.getTime() < REFRESH_WINDOW_MS) {
    return { scopeKey, sourceAsOf: cachedRun.sourceAsOf?.toISOString() ?? null };
  }

  const source = await fetchBusinessSignals(actor, requestId);
  if ((source.scope === 'own') !== viewerScopeKey.startsWith('rep:')) throw new Error('Analytics signal scope did not match the requesting actor');
  const candidates = mode === 'ai'
    ? await generateRecommendations(source)
    : buildRecommendations(source.signals);
  const keys = candidates.map((item) => item.key);

  await prisma.$transaction(async (tx) => {
    if (keys.length) {
      await tx.recommendation.updateMany({
        where: { scopeKey, active: true, key: { notIn: keys } },
        data: { active: false },
      });
    } else {
      await tx.recommendation.updateMany({ where: { scopeKey, active: true }, data: { active: false } });
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
      ...(status === 'active' ? { feedback: { none: { actorId: actor.id, status: { in: ['dismissed', 'completed'] } } } } : {}),
      ...(status === 'reviewed' ? { feedback: { some: { actorId: actor.id, status: 'reviewed' } } } : {}),
      ...(status === 'dismissed' ? { feedback: { some: { actorId: actor.id, status: 'dismissed' } } } : {}),
      ...(status === 'completed' ? { feedback: { some: { actorId: actor.id, status: 'completed' } } } : {}),
    },
    include: { feedback: { where: { actorId: actor.id }, take: 1 } },
  });

  rows.sort((left, right) => (priorityRank[left.priority] ?? 3) - (priorityRank[right.priority] ?? 3));
  return {
    scope: baseScopeKey(actor) === 'agency' ? 'agency' : 'own',
    mode,
    sourceAsOf,
    recommendations: rows.map(({ feedback, ...item }) => ({
      ...item,
      relatedRecordIds: Array.isArray(item.relatedRecordIds) ? item.relatedRecordIds : [],
      evidence: Array.isArray(item.evidence) ? item.evidence : [],
      action: item.action,
      viewerStatus: feedback[0]?.status ?? 'new',
    })),
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